/**
 * Backfill POSTED LeaveRequest records from NovaTime usage (T-type) rows.
 *
 * Each T-type XLS row = one day of leave taken → one POSTED LeaveRequest.
 * Status POSTED means it was already applied to timecards.
 *
 * With balanceMinutes set to gross earned (available + used) in backfill-leave-balances,
 * the UI computes:  available = balanceMinutes - sum(POSTED durationMinutes)
 *                             = (XLS available + XLS used) - XLS used
 *                             = XLS available  ✓
 *
 * After running, a comparison report is printed:
 *   UI available (computed) vs XLS available — should match for all employees.
 *
 * Existing backfilled LeaveRequest rows (identified by note = 'novatime-import')
 * are deleted and replaced on each run.
 */

const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const XLS_PATH = 'C:/Users/john.raefski/Downloads/History Used and accruaeds PTO, PTOC, Sickdays.xls';
const IMPORT_NOTE = 'novatime-import';

const PAYCODE_TO_LEAVE_TYPE = {
  5:  'lt-pto',
  41: 'cmq74gsfc000104l7f0ezns2o',
  42: 'lt-sick',
  3:  'lt-sick',
};

function parsePaycodeNum(val) {
  if (!val || typeof val !== 'string') return null;
  const m = val.match(/^(\d+)\s*\[/);
  return m ? parseInt(m[1]) : null;
}

function parseEmpId(val) {
  if (!val || typeof val !== 'string') return null;
  const m = val.match(/^(\d+)\s*\[/);
  return m ? m[1] : null;
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  console.log('\n=== BACKFILL LEAVE REQUESTS (POSTED USAGE) ===\n');

  const wb = xlsx.readFile(XLS_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  const dataRows = rows.slice(1);

  // Load employees: employeeCode → id, with wmsId fallback
  const employees = await db.employee.findMany({ select: { id: true, employeeCode: true, wmsId: true } });
  const empByCode = new Map(employees.map(e => [e.employeeCode, e.id]));
  const empByWms  = new Map(employees.filter(e => e.wmsId).map(e => [e.wmsId, e.id]));

  // Delete previously backfilled requests
  const deleted = await db.leaveRequest.deleteMany({ where: { note: IMPORT_NOTE } });
  console.log(`Deleted ${deleted.count} previously backfilled LeaveRequest rows`);

  // Collect T-type (usage) rows
  const toCreate = [];
  let skippedEmp = 0;

  for (const row of dataRows) {
    if (row[idx['Post Type']] !== 'T') continue;

    const empId      = parseEmpId(String(row[idx['Employee']] || ''));
    const paycodeNum = parsePaycodeNum(String(row[idx['Paycode']] || ''));
    if (!empId || !paycodeNum) continue;

    const leaveTypeId = PAYCODE_TO_LEAVE_TYPE[paycodeNum];
    if (!leaveTypeId) continue;

    // Collect all DB employee IDs (write to both on collision)
    const byCode = empByCode.get(empId);
    const byWms  = empByWms.get(empId);
    const employeeIds = [...new Set([byWms, byCode].filter(Boolean))];
    if (employeeIds.length === 0) { skippedEmp++; continue; }

    const usedHours = Number(row[idx['Used Hours']]) || 0;
    if (usedHours <= 0) continue;

    const postDate = parseDate(row[idx['Post Date']]);
    if (!postDate) continue;

    for (const employeeId of employeeIds) {
      toCreate.push({
        employeeId,
        leaveTypeId,
        status:          'POSTED',
        startDate:       postDate,
        endDate:         postDate,
        durationMinutes: Math.round(usedHours * 60),
        note:            IMPORT_NOTE,
        postedAt:        postDate,
        submittedAt:     postDate,
      });
    }
  }

  console.log(`LeaveRequest rows to create: ${toCreate.length}`);
  console.log(`Skipped (emp not in DB): ${skippedEmp}`);

  // Insert in batches
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < toCreate.length; i += BATCH) {
    await db.leaveRequest.createMany({ data: toCreate.slice(i, i + BATCH) });
    written += Math.min(BATCH, toCreate.length - i);
    process.stdout.write(`  wrote ${Math.min(i + BATCH, toCreate.length)} / ${toCreate.length}\r`);
  }
  console.log(`\nLeaveRequest rows written: ${written}`);

  // ── Verification report ──────────────────────────────────────────────────
  console.log('\n--- VERIFICATION: computed available vs XLS available ---\n');

  // Build XLS available balance per empId per leaveTypeId
  const xlsAvail = new Map(); // `${empId}|${leaveTypeId}` → hours
  for (const row of dataRows) {
    const empId      = parseEmpId(String(row[idx['Employee']] || ''));
    const paycodeNum = parsePaycodeNum(String(row[idx['Paycode']] || ''));
    if (!empId || !paycodeNum) continue;
    const leaveTypeId = PAYCODE_TO_LEAVE_TYPE[paycodeNum];
    if (!leaveTypeId) continue;

    const postDate = row[idx['Post Date']];
    const availBal = Number(row[idx['Available Balance']]) || 0;
    const key = `${empId}|${leaveTypeId}`;

    // Keep the last-seen row for the latest date (same logic as balance script)
    const parsed = parseDate(postDate);
    if (parsed) {
      const existing = xlsAvail.get(key);
      if (!existing || parsed >= existing.date) {
        xlsAvail.set(key, { date: parsed, hours: availBal });
      }
    }
  }

  // Load DB balances and posted requests
  const [dbBalances, dbPosted] = await Promise.all([
    db.leaveBalance.findMany({
      where: { accrualYear: 2026 },
      select: { employeeId: true, leaveTypeId: true, balanceMinutes: true,
                employee: { select: { employeeCode: true, wmsId: true } } },
    }),
    db.leaveRequest.findMany({
      where: { note: IMPORT_NOTE, status: 'POSTED' },
      select: { employeeId: true, leaveTypeId: true, durationMinutes: true },
    }),
  ]);

  // Sum posted minutes per employee per leave type
  const postedMap = new Map(); // `${empId}|${ltId}` → minutes
  for (const r of dbPosted) {
    const key = `${r.employeeId}|${r.leaveTypeId}`;
    postedMap.set(key, (postedMap.get(key) || 0) + r.durationMinutes);
  }

  let ok = 0, mismatch = 0;
  const mismatches = [];

  for (const bal of dbBalances) {
    const empCode     = bal.employee.employeeCode;
    // Use wmsId (raw XLS key) when employeeCode has a prefix (e.g. D0F110345 → 110345)
    const xlsEmpId    = bal.employee.wmsId ?? empCode;
    const empLtKey    = `${xlsEmpId}|${bal.leaveTypeId}`;
    // balanceMinutes = XLS net available (POSTED requests already baked in, not subtracted by UI)
    // So available = balanceMinutes directly — do not subtract postedMin
    const computedMin = bal.balanceMinutes;
    const xlsEntry    = xlsAvail.get(empLtKey);
    const xlsMin      = xlsEntry ? Math.round(xlsEntry.hours * 60) : null;

    if (xlsMin === null) continue; // no XLS data for this employee/type

    const diff = computedMin - xlsMin;
    if (Math.abs(diff) <= 1) { // allow 1-minute rounding tolerance
      ok++;
    } else {
      mismatch++;
      mismatches.push({ empCode, leaveTypeId: bal.leaveTypeId, computedMin, xlsMin, diff });
    }
  }

  console.log(`Match: ${ok}  Mismatch: ${mismatch}`);
  if (mismatches.length > 0) {
    console.log('\nMismatches (computed vs XLS, in minutes):');
    mismatches.slice(0, 20).forEach(m =>
      console.log(`  ${m.empCode.padEnd(10)} lt=${m.leaveTypeId.slice(0, 12).padEnd(12)} computed=${String(m.computedMin).padStart(6)}  xls=${String(m.xlsMin).padStart(6)}  diff=${m.diff}`)
    );
    if (mismatches.length > 20) console.log(`  ... and ${mismatches.length - 20} more`);
  }

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
