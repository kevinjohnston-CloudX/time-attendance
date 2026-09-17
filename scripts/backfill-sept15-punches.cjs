/**
 * Backfill missing Sept 15 punches from the Nova XLS into Cloud Time.
 *
 * For each employee whose Nova row shows in+out on 2026-09-15 but Cloud Time
 * has no punches that day, creates a CLOCK_IN and CLOCK_OUT punch sourced as
 * MANUAL with a note indicating the import.
 *
 * Usage:
 *   node scripts/backfill-sept15-punches.cjs --dry-run   [preview]
 *   node scripts/backfill-sept15-punches.cjs              [apply]
 */

const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const NOVA_XLS      = process.argv.find(a => a.endsWith('.xls') || a.endsWith('.xlsx'))
                    ?? 'C:/Users/john.raefski/Downloads/Cloud Time(NJIMENEZ)-229996-26857.xls';
const TARGET_DATE   = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-09-15';
const SKIP_PAYCODES = new Set([33]);
const DRY_RUN       = process.argv.includes('--dry-run');
const NOTE          = `Backfilled from NovaTime XLS – ${TARGET_DATE}`;

// ── helpers ──────────────────────────────────────────────────────────────────

function parseTimeStr(val) {
  if (!val && val !== 0) return null;
  const s = String(val).trim().replace(/\*/g, '');
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = m[3].toUpperCase();
    if (ampm === 'AM' && h === 12) h = 0;
    if (ampm === 'PM' && h !== 12) h += 12;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  return null;
}

function parseDateStr(val) {
  if (!val) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/** Build a UTC Date from a local date string (YYYY-MM-DD) + time string (HH:MM) + IANA tz */
function localToUtc(dateStr, timeStr, tz) {
  // Use the Intl API to determine offset at that local moment.
  // Approach: try to parse as UTC, then adjust.
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, min]   = timeStr.split(':').map(Number);
  // Create a date in the specified timezone using a hack:
  // Format a known UTC instant in the target tz and compare with expected local.
  // Simpler: use the date as UTC midnight and shift by the named-tz offset.
  // Best approach for Node 16+: Temporal not available, use offset calculation.
  const naive = new Date(Date.UTC(y, mo - 1, d, h, min, 0));
  // Get what the tz thinks this UTC instant looks like
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(naive).map(p => [p.type, p.value]));
  const utcH = parseInt(parts.hour, 10);
  const utcMin = parseInt(parts.minute, 10);
  const wantH = h, wantMin = min;
  const offsetMin = (wantH * 60 + wantMin) - (utcH * 60 + utcMin);
  return new Date(naive.getTime() - offsetMin * 60 * 1000);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? '\n=== DRY RUN ===' : '\n=== LIVE UPDATE ===');

  // 1. Parse Nova XLS ─────────────────────────────────────────────────────────
  const wb  = xlsx.readFile(NOVA_XLS);
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerIdx = 0;
  for (let i = 0; i < 10; i++) {
    if (raw[i].join(' ').toLowerCase().includes('work date')) { headerIdx = i; break; }
  }
  const headers = raw[headerIdx].map(h => String(h).trim().toLowerCase());
  const col = n => headers.findIndex(h => h === n);

  // Collect TARGET_DATE rows with both in+out — keep ALL pairs per badge (split shifts)
  const novaMap = new Map(); // badgeId → { name, pairs: [{inTime, outTime}] }
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const empCell = String(row[col('employee')] ?? '').trim();
    if (!empCell) continue;
    const paycodeRaw = String(row[col('paycode')] ?? '').trim();
    const pcMatch = paycodeRaw.match(/^(\d+)/);
    if (!pcMatch || SKIP_PAYCODES.has(parseInt(pcMatch[1], 10))) continue;
    const workDate = parseDateStr(row[col('work date')]);
    if (workDate !== TARGET_DATE) continue;
    const spaceIdx = empCell.indexOf(' ');
    const badgeId  = spaceIdx > 0 ? empCell.slice(0, spaceIdx) : empCell;
    const name     = spaceIdx > 0 ? empCell.slice(spaceIdx + 1).replace(/^\[|\]$/g, '').trim() : '';
    const inTime   = parseTimeStr(row[col('in')]);
    const outTime  = parseTimeStr(row[col('out')]);
    if (!inTime || !outTime) continue; // skip rows without both times
    if (!novaMap.has(badgeId)) novaMap.set(badgeId, { name, pairs: [] });
    novaMap.get(badgeId).pairs.push({ inTime, outTime });
  }
  const totalPairs = [...novaMap.values()].reduce((s, v) => s + v.pairs.length, 0);
  console.log(`Nova employees on ${TARGET_DATE} with in+out: ${novaMap.size} (${totalPairs} punch pairs)`);

  // 2. Load matching employees from DB ────────────────────────────────────────
  const badgeIds  = [...novaMap.keys()];
  const employees = await db.employee.findMany({
    where: { wmsId: { in: badgeIds } },
    select: {
      id: true, wmsId: true, tenantId: true, ruleSetId: true,
      user: { select: { name: true } },
      site: { select: { timezone: true } },
    },
  });
  const empByWms = new Map(employees.map(e => [e.wmsId, e]));
  console.log(`Employees found in DB: ${empByWms.size}`);

  // 3. Check which ones already have punches on Sept 15 in Cloud Time ─────────
  const sept15Start = new Date(TARGET_DATE + 'T00:00:00Z');
  const sept15End   = new Date(TARGET_DATE + 'T23:59:59Z');

  const existingPunches = await db.punch.findMany({
    where: {
      employeeId: { in: employees.map(e => e.id) },
      punchTime: { gte: sept15Start, lte: sept15End },
      isRejected: false,
      correctedById: null,
    },
    select: { employeeId: true, punchType: true },
  });
  const empIdsWithPunches = new Set(existingPunches.map(p => p.employeeId));
  console.log(`Already have punches on ${TARGET_DATE}: ${empIdsWithPunches.size}`);

  // 4. Determine who needs backfilling ────────────────────────────────────────
  const toBackfill = [];
  for (const [badgeId, nova] of novaMap) {
    const emp = empByWms.get(badgeId);
    if (!emp) continue; // not in DB
    if (empIdsWithPunches.has(emp.id)) continue; // already has punches
    toBackfill.push({ emp, nova, badgeId });
  }
  console.log(`Need backfilling: ${toBackfill.length}\n`);

  if (toBackfill.length === 0) {
    console.log('Nothing to do.');
    await db.$disconnect(); await pool.end(); return;
  }

  // 5. Load pay periods that cover Sept 15, grouped by ruleSetId ─────────────
  // (Employees in the same ruleset share the same pay period schedule)
  const ruleSetIds = [...new Set(toBackfill.map(r => r.emp.ruleSetId))];
  const tenantIds  = [...new Set(toBackfill.map(r => r.emp.tenantId))];

  // Find pay periods where startDate <= 2026-09-15 <= endDate
  const payPeriods = await db.payPeriod.findMany({
    where: {
      tenantId: { in: tenantIds },
      startDate: { lte: new Date('2026-09-15T23:59:59Z') },
      endDate:   { gte: new Date('2026-09-15T00:00:00Z') },
    },
    select: { id: true, tenantId: true, ruleSetId: true, startDate: true, endDate: true, status: true },
  });

  // Build lookup: ruleSetId (or null→tenantId) → pay period
  const ppByRuleSet = new Map();
  const ppByTenant  = new Map();
  for (const pp of payPeriods) {
    if (pp.ruleSetId) ppByRuleSet.set(pp.ruleSetId, pp);
    else ppByTenant.set(pp.tenantId, pp);
  }

  // 6. Find/create timesheets + create punches ────────────────────────────────
  let created = 0;
  let skippedLocked = 0;
  let skippedNoPP = 0;

  for (const { emp, nova } of toBackfill) {
    const tz = emp.site?.timezone ?? 'America/New_York';

    // Find pay period for this employee
    const pp = (emp.ruleSetId ? ppByRuleSet.get(emp.ruleSetId) : null)
            ?? ppByTenant.get(emp.tenantId);

    if (!pp) {
      console.log(`  SKIP (no pay period) ${emp.wmsId} "${emp.user.name}"`);
      skippedNoPP++;
      continue;
    }
    if (pp.status === 'LOCKED' || pp.status === 'PAYROLL_APPROVED') {
      console.log(`  SKIP (${pp.status}) ${emp.wmsId} "${emp.user.name}"`);
      skippedLocked++;
      continue;
    }

    const pairSummary = nova.pairs.map(p => `${p.inTime}→${p.outTime}`).join('  ');

    if (DRY_RUN) {
      console.log(`  ${emp.wmsId.padEnd(10)} "${emp.user.name}"  ${pairSummary}  [${tz}]  pp=${pp.status}`);
      created += nova.pairs.length;
      continue;
    }

    // Find or create timesheet
    const timesheet = await db.timesheet.upsert({
      where: { employeeId_payPeriodId: { employeeId: emp.id, payPeriodId: pp.id } },
      create: { employeeId: emp.id, payPeriodId: pp.id },
      update: {},
      select: { id: true },
    });

    // Create all in/out pairs in chronological order
    // Sort pairs by inTime so state machine is consistent
    const sorted = [...nova.pairs].sort((a, b) => a.inTime.localeCompare(b.inTime));
    for (const pair of sorted) {
      // Determine date for out — if outTime < inTime it crossed midnight
      const outDate = pair.outTime < pair.inTime
        ? new Date(new Date(TARGET_DATE + 'T00:00:00Z').getTime() + 86400000)
            .toISOString().slice(0, 10)
        : TARGET_DATE;
      const inUtc  = localToUtc(TARGET_DATE, pair.inTime,  tz);
      const outUtc = localToUtc(outDate,      pair.outTime, tz);

      await db.punch.create({
        data: { employeeId: emp.id, timesheetId: timesheet.id, punchType: 'CLOCK_IN',
                punchTime: inUtc, roundedTime: inUtc, source: 'MANUAL',
                stateBefore: 'OUT', stateAfter: 'WORK', isApproved: true, note: NOTE },
      });
      await db.punch.create({
        data: { employeeId: emp.id, timesheetId: timesheet.id, punchType: 'CLOCK_OUT',
                punchTime: outUtc, roundedTime: outUtc, source: 'MANUAL',
                stateBefore: 'WORK', stateAfter: 'OUT', isApproved: true, note: NOTE },
      });
      created++;
    }
    console.log(`  ✓ ${emp.wmsId.padEnd(10)} "${emp.user.name}"  ${pairSummary}`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Backfilled (${DRY_RUN ? 'would create' : 'created'}) in/out pairs: ${created}`);
  console.log(`Skipped — no pay period:    ${skippedNoPP}`);
  console.log(`Skipped — period locked:    ${skippedLocked}`);
  if (DRY_RUN) console.log('\nDry run complete. Re-run without --dry-run to apply.');

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
