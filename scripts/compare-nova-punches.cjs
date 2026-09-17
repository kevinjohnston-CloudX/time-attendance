/**
 * Compare NovaTime in/out punch data against Cloud Time DB punches.
 * Usage: node scripts/compare-nova-punches.cjs <path-to-xls>
 */

const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const FILE = process.argv[2];
if (!FILE) { console.error('Usage: node scripts/compare-nova-punches.cjs <path-to-xls>'); process.exit(1); }

// Paycodes to skip — salary rows with no punch times
const SKIP_PAYCODES = new Set([33]);

function parseTimeStr(val) {
  if (val === '' || val == null) return null;
  const s = String(val).trim().replace(/\*/g, '');
  if (!s) return null;
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
  if (val === '' || val == null) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function fmt(d, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

async function main() {
  console.log(`\nFile: ${FILE}\n`);

  const wb = xlsx.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Find header row (contains "work date")
  let headerIdx = 0;
  for (let i = 0; i < 10; i++) {
    if (raw[i].join(' ').toLowerCase().includes('work date')) { headerIdx = i; break; }
  }
  const headers = raw[headerIdx].map(h => String(h).trim().toLowerCase());
  const col = n => headers.findIndex(h => h === n);

  const novaRows = [];
  let salCount = 0;

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    const empCell = String(row[col('employee')] ?? '').trim();
    if (!empCell) continue;
    const paycodeRaw = String(row[col('paycode')] ?? '').trim();
    if (!paycodeRaw) continue;
    const pcMatch = paycodeRaw.match(/^(\d+)/);
    if (!pcMatch) continue;
    const paycodeNum = parseInt(pcMatch[1], 10);

    if (SKIP_PAYCODES.has(paycodeNum)) { salCount++; continue; }

    const spaceIdx = empCell.indexOf(' ');
    const badgeId = spaceIdx > 0 ? empCell.slice(0, spaceIdx) : empCell;
    const name = spaceIdx > 0 ? empCell.slice(spaceIdx + 1).replace(/^\[|\]$/g, '').trim() : '';
    const workDate = parseDateStr(row[col('work date')]);
    if (!workDate) continue;

    novaRows.push({
      badgeId, name, workDate,
      inTime:  parseTimeStr(row[col('in')]),
      outTime: parseTimeStr(row[col('out')]),
      paycodeNum, paycodeLabel: paycodeRaw,
    });
  }

  const badgeIds = [...new Set(novaRows.map(r => r.badgeId))];

  // Primary lookup: by wmsId
  const employees = await db.employee.findMany({
    where: { wmsId: { in: badgeIds } },
    select: {
      id: true, wmsId: true, employeeCode: true,
      user: { select: { name: true } },
      site: { select: { name: true, timezone: true } },
    },
  });
  const empByWms = new Map(employees.map(e => [e.wmsId, e]));

  // Secondary lookup: by name for badge IDs with no wmsId match
  const unmatchedBadgeIds = badgeIds.filter(id => !empByWms.has(id));
  // Build a name→badgeId map from nova rows for unmatched IDs
  const novaNameMap = new Map(); // normalised name → badgeId
  for (const r of novaRows) {
    if (!unmatchedBadgeIds.includes(r.badgeId)) continue;
    const norm = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm) novaNameMap.set(norm, r.badgeId);
  }

  // Load all employees with names to attempt name matching
  const allEmpNames = await db.employee.findMany({
    where: { user: { name: { not: null } } },
    select: {
      id: true, wmsId: true, employeeCode: true,
      user: { select: { name: true } },
      site: { select: { name: true, timezone: true } },
    },
  });

  // Try to match each unmatched badge by normalised name
  const nameMatchedBy = new Map(); // badgeId → employee
  const nameMatchLog  = [];
  for (const emp of allEmpNames) {
    const norm = (emp.user.name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm) continue;
    // Also try "LASTNAME FIRSTNAME" flipped since nova is "LAST, FIRST"
    const novaId = novaNameMap.get(norm);
    if (novaId && !nameMatchedBy.has(novaId)) {
      nameMatchedBy.set(novaId, emp);
      nameMatchLog.push({ badgeId: novaId, dbName: emp.user.name, dbCode: emp.employeeCode, dbWms: emp.wmsId });
    }
  }

  // Merged lookup: wmsId match first, then name match
  const empLookup = new Map([...empByWms]);
  for (const [badgeId, emp] of nameMatchedBy) empLookup.set(badgeId, emp);

  const matchedRows = novaRows.filter(r => empLookup.has(r.badgeId));
  const notFound = badgeIds.filter(id => !empLookup.has(id));
  // Names we couldn't match at all
  const notFoundNames = [...new Set(
    novaRows.filter(r => notFound.includes(r.badgeId)).map(r => `${r.badgeId} ${r.name}`)
  )];

  console.log(`Salary rows skipped (paycode 33):  ${salCount}`);
  console.log(`NovaTime punch rows (non-salary):  ${novaRows.length} (${badgeIds.length} employees)`);
  console.log(`Matched by wmsId:                  ${employees.length}`);
  console.log(`Matched by name (no wmsId):        ${nameMatchedBy.size}`);
  console.log(`Total matched:                     ${empLookup.size}`);
  console.log(`Still not found:                   ${notFound.length}`);

  if (nameMatchLog.length) {
    console.log(`\nNAME MATCHES (no wmsId on record):`);
    for (const m of nameMatchLog)
      console.log(`  badge=${m.badgeId}  dbCode=${m.dbCode}  dbWms=${m.dbWms ?? 'null'}  dbName="${m.dbName}"`);
  }
  if (notFoundNames.length) {
    console.log(`\nNOT FOUND IN CLOUD TIME (${notFound.length}):`);
    notFoundNames.forEach(n => console.log(`  ${n}`));
  }
  console.log();

  const dates = matchedRows.map(r => r.workDate).sort();
  const startDate = new Date(dates[0] + 'T00:00:00Z');
  const endDate   = new Date(dates[dates.length - 1] + 'T23:59:59Z');

  const dbPunches = await db.punch.findMany({
    where: {
      employeeId: { in: employees.map(e => e.id) },
      punchTime: { gte: startDate, lte: endDate },
      correctedById: null,
      isRejected: false,
    },
    orderBy: { punchTime: 'asc' },
    select: {
      punchTime: true, roundedTime: true, punchType: true, note: true,
      employee: { select: { wmsId: true, site: { select: { timezone: true } } } },
    },
  });

  // Build day map: wmsId|date → { ins, outs }
  const dayMap = new Map();
  for (const p of dbPunches) {
    const tz = p.employee.site?.timezone ?? 'America/New_York';
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(p.punchTime);
    const key = `${p.employee.wmsId}|${localDate}`;
    if (!dayMap.has(key)) dayMap.set(key, { ins: [], outs: [] });
    const entry = dayMap.get(key);
    const rec = { t: p.roundedTime ?? p.punchTime };
    if (p.punchType === 'CLOCK_IN')  entry.ins.push(rec);
    if (p.punchType === 'CLOCK_OUT') entry.outs.push(rec);
  }

  const missingBoth = [];
  const missingIn   = [];
  const missingOut  = [];
  const noTimes     = [];

  for (const nova of matchedRows) {
    const emp  = empLookup.get(nova.badgeId);
    const tz   = emp.site?.timezone ?? 'America/New_York';
    const site = emp.site?.name ?? '?';
    const key  = `${nova.badgeId}|${nova.workDate}`;
    const day  = dayMap.get(key);
    const dbIn  = day?.ins.length  ? fmt(day.ins[0].t,  tz) : null;
    const dbOut = day?.outs.length ? fmt(day.outs[day.outs.length - 1].t, tz) : null;

    if (!nova.inTime && !nova.outTime) { noTimes.push({ nova, site }); continue; }
    if (!nova.inTime || !nova.outTime) continue; // partial nova row — skip

    if (!dbIn && !dbOut) missingBoth.push({ nova, site });
    else if (!dbIn)       missingIn.push({ nova, dbIn, dbOut, site });
    else if (!dbOut)      missingOut.push({ nova, dbIn, dbOut, site });
  }

  if (missingBoth.length) {
    console.log(`=== NOVA HAS IN+OUT — DB HAS NOTHING (${missingBoth.length}) ===\n`);
    for (const r of missingBoth)
      console.log(`  [${r.site}] ${r.nova.badgeId}  ${r.nova.name.padEnd(36)}  ${r.nova.workDate}  Nova:${r.nova.inTime}→${r.nova.outTime}  paycode=${r.nova.paycodeNum}`);
    console.log();
  }

  if (missingIn.length) {
    console.log(`=== NOVA HAS IN+OUT — DB MISSING CLOCK-IN (${missingIn.length}) ===\n`);
    for (const r of missingIn)
      console.log(`  [${r.site}] ${r.nova.badgeId}  ${r.nova.name.padEnd(36)}  ${r.nova.workDate}  Nova:${r.nova.inTime}→${r.nova.outTime}  DB:null→${r.dbOut}`);
    console.log();
  }

  if (missingOut.length) {
    console.log(`=== NOVA HAS IN+OUT — DB MISSING CLOCK-OUT (${missingOut.length}) ===\n`);
    for (const r of missingOut)
      console.log(`  [${r.site}] ${r.nova.badgeId}  ${r.nova.name.padEnd(36)}  ${r.nova.workDate}  Nova:${r.nova.inTime}→${r.nova.outTime}  DB:${r.dbIn}→null`);
    console.log();
  }

  if (noTimes.length) {
    console.log(`=== NO TIMES IN NOVATIME — leave/holiday rows (${noTimes.length}) ===\n`);
    for (const r of noTimes)
      console.log(`  [${r.site}] ${r.nova.badgeId}  ${r.nova.name.padEnd(36)}  ${r.nova.workDate}  paycode=${r.nova.paycodeNum} [${r.nova.paycodeLabel}]`);
    console.log();
  }

  const totalGaps = missingBoth.length + missingIn.length + missingOut.length;
  console.log(`=== SUMMARY ===`);
  console.log(`Salary rows skipped (paycode 33):  ${salCount}`);
  console.log(`No times in NovaTime (leave/hol):  ${noTimes.length}`);
  console.log(`Missing both in+out:               ${missingBoth.length}`);
  console.log(`Missing clock-in only:             ${missingIn.length}`);
  console.log(`Missing clock-out only:            ${missingOut.length}`);
  console.log(`Total with gaps:                   ${totalGaps}`);
  if (totalGaps === 0 && noTimes.length === 0) console.log('\n✓ All punch rows match Cloud Time.');
}

main().catch(console.error).finally(async () => { await db.$disconnect(); await pool.end(); });
