/**
 * Backfill 2026 leave balances from NovaTime history XLS.
 *
 * Source: "History Used and accruaeds PTO, PTOC, Sickdays.xls"
 * Covers: 1/1/2026 – 9/9/2026
 *
 * Paycode → LeaveType mapping:
 *   5  [PTO]   → LeaveType "PTO"           (lt-pto)
 *   41 [PTOC]  → LeaveType "PTO Carry Over"
 *   42 [NJSK]  → LeaveType "Sick Leave"    (lt-sick)
 *   3  [CASK]  → LeaveType "Sick Leave"    (lt-sick)  ← same bucket, different policy
 *
 * NJSK and CASK are merged into a single Sick Leave balance per employee.
 * Existing LeaveBalance rows (test data) are deleted and replaced.
 * LeaveAccrualLedger is NOT touched — balances are seeded directly.
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
const ACCRUAL_YEAR = 2026;

// XLS paycode number → LeaveType id
const PAYCODE_TO_LEAVE_TYPE = {
  5:  'lt-pto',
  41: 'cmq74gsfc000104l7f0ezns2o',   // PTO Carry Over
  42: 'lt-sick',                      // NJ Sick → Sick Leave bucket
  3:  'lt-sick',                      // CA Sick → same Sick Leave bucket
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
  console.log('\n=== BACKFILL LEAVE BALANCES ===\n');

  // Load XLS
  const wb = xlsx.readFile(XLS_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  const dataRows = rows.slice(1);
  console.log(`XLS rows: ${dataRows.length}`);

  // Build per-employee per-paycode summary from XLS
  // Structure: empId → paycodeNum → { latestDate, latestAvail, totalUsedHours }
  const summary = new Map(); // empId → Map(paycodeNum → {latestDate, latestAvail, totalUsedHours})

  for (const row of dataRows) {
    const empRaw   = row[idx['Employee']];
    const empId    = parseEmpId(empRaw);
    if (!empId) continue; // skip POSITIO and blanks

    const paycodeNum = parsePaycodeNum(String(row[idx['Paycode']] || ''));
    if (!PAYCODE_TO_LEAVE_TYPE[paycodeNum]) continue; // skip unmapped paycodes

    const postDate   = row[idx['Post Date']];
    const postType   = row[idx['Post Type']];
    const availBal   = Number(row[idx['Available Balance']]) || 0;
    const usedHours  = Number(row[idx['Used Hours']]) || 0;

    if (!summary.has(empId)) summary.set(empId, new Map());
    const empMap = summary.get(empId);

    if (!empMap.has(paycodeNum)) {
      empMap.set(paycodeNum, { latestDate: null, latestAvail: 0, totalUsedHours: 0 });
    }
    const entry = empMap.get(paycodeNum);

    // Track the most recent Available Balance
    const d = parseDate(postDate);
    if (d && (!entry.latestDate || d >= entry.latestDate)) {
      entry.latestDate  = d;
      entry.latestAvail = availBal;
    }

    // Sum usage rows
    if (postType === 'T') {
      entry.totalUsedHours += usedHours;
    }
  }

  console.log(`Unique employees in XLS: ${summary.size}`);

  // Load DB employee map: employeeCode → employee.id, with wmsId fallback
  const employees = await db.employee.findMany({ select: { id: true, employeeCode: true, wmsId: true } });
  const empByCode = new Map(employees.map(e => [e.employeeCode, e.id]));
  const empByWms  = new Map(employees.filter(e => e.wmsId).map(e => [e.wmsId, e.id]));
  console.log(`Employees in DB: ${employees.length}`);

  // Delete all existing LeaveBalance rows (test data)
  const deleted = await db.leaveBalance.deleteMany({});
  console.log(`Deleted ${deleted.count} existing LeaveBalance rows`);

  // Build upsert data — merge NJSK + CASK into single Sick Leave per employee
  let matched = 0, skipped = 0, written = 0;

  // Per employee, collect bucket totals
  // buckets: leaveTypeId → { balanceHours, usedHours }
  const toWrite = []; // { employeeId, leaveTypeId, balanceMinutes, usedMinutes }

  for (const [empId, paycodeMap] of summary) {
    // Collect all DB employee IDs that map to this XLS empId.
    // When both a plain-numeric-code employee AND a wmsId-prefixed employee (D0F...) exist,
    // write to both so that whichever record the UI is using shows the data.
    const byCode = empByCode.get(empId);
    const byWms  = empByWms.get(empId);
    const employeeIds = [...new Set([byWms, byCode].filter(Boolean))];
    if (employeeIds.length === 0) {
      skipped++;
      continue;
    }
    matched++;

    // Aggregate by leaveTypeId (NJSK and CASK merge into lt-sick)
    const buckets = new Map(); // leaveTypeId → { balanceHours, usedHours }

    for (const [paycodeNum, entry] of paycodeMap) {
      const leaveTypeId = PAYCODE_TO_LEAVE_TYPE[paycodeNum];
      if (!leaveTypeId) continue;

      if (!buckets.has(leaveTypeId)) {
        buckets.set(leaveTypeId, { balanceHours: 0, usedHours: 0 });
      }
      const b = buckets.get(leaveTypeId);
      b.balanceHours += entry.latestAvail;
      b.usedHours    += entry.totalUsedHours;
    }

    for (const employeeId of employeeIds) {
      for (const [leaveTypeId, { balanceHours, usedHours }] of buckets) {
        // balanceMinutes = XLS net available balance.
        // POSTED LeaveRequests are not subtracted from Available in the UI
        // (POSTED = already applied to timecard, balance already reflects it).
        toWrite.push({
          employeeId,
          leaveTypeId,
          balanceMinutes: Math.round(balanceHours * 60),
          usedMinutes:    Math.round(usedHours * 60),
          accrualYear:    ACCRUAL_YEAR,
        });
      }
    }
  }

  // Write in batches of 500
  const BATCH = 500;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    await db.leaveBalance.createMany({ data: toWrite.slice(i, i + BATCH) });
    written += Math.min(BATCH, toWrite.length - i);
    process.stdout.write(`  wrote ${Math.min(i + BATCH, toWrite.length)} / ${toWrite.length}\r`);
  }

  console.log(`\nDone.`);
  console.log(`  XLS employees matched to DB: ${matched}`);
  console.log(`  XLS employees not in DB (skipped): ${skipped}`);
  console.log(`  LeaveBalance rows written: ${written}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
