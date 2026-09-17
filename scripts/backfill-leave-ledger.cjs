/**
 * Backfill LeaveAccrualLedger entries from NovaTime history XLS.
 *
 * Source: "History Used and accruaeds PTO, PTOC, Sickdays.xls"
 * Covers: 1/1/2026 – 9/9/2026
 *
 * Post type → AccrualAction mapping:
 *   S → ACCRUAL           (periodic accrual)
 *   T → USAGE             (leave taken)
 *   U → CARRY_OVER        (transfer in from another bucket)
 *   * → BALANCE_RESET     (year-start transfer out / balance reset)
 *   # → BALANCE_RESET     (usage counter reset)
 *   ! → EARNED_ADJUSTMENT (earned amount reset)
 *
 * Delta formula: (accrualHours - usedHours + adjustHours) * 60 minutes
 *
 * Deduplication: NovaTime sometimes prints the same transaction multiple
 * times in the report. Rows with identical (empId, paycodeNum, postDate,
 * postType, availBal) are collapsed to one entry.
 *
 * Existing ledger rows (test data) are deleted before writing.
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

const PAYCODE_TO_LEAVE_TYPE = {
  5:  'lt-pto',
  41: 'cmq74gsfc000104l7f0ezns2o',
  42: 'lt-sick',
  3:  'lt-sick',
};

const POST_TYPE_TO_ACTION = {
  'S': 'ACCRUAL',
  'T': 'USAGE',
  'U': 'CARRY_OVER',
  '*': 'BALANCE_RESET',
  '#': 'BALANCE_RESET',
  '!': 'EARNED_ADJUSTMENT',
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
  console.log('\n=== BACKFILL LEAVE ACCRUAL LEDGER ===\n');

  const wb = xlsx.readFile(XLS_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  const dataRows = rows.slice(1);
  console.log(`XLS rows: ${dataRows.length}`);

  // Load employee map: employeeCode → id, with wmsId fallback
  const employees = await db.employee.findMany({ select: { id: true, employeeCode: true, wmsId: true } });
  const empByCode = new Map(employees.map(e => [e.employeeCode, e.id]));
  const empByWms  = new Map(employees.filter(e => e.wmsId).map(e => [e.wmsId, e.id]));

  // Delete existing ledger entries (test data)
  const deleted = await db.leaveAccrualLedger.deleteMany({});
  console.log(`Deleted ${deleted.count} existing ledger rows`);

  // Parse and deduplicate XLS rows
  // Dedup key: empId|paycodeNum|postDate|postType|availBal
  const seen = new Set();
  const ledgerRows = [];
  let skippedEmp = 0, skippedDupe = 0, skippedNoAction = 0;

  for (const row of dataRows) {
    const empId      = parseEmpId(String(row[idx['Employee']] || ''));
    const paycodeNum = parsePaycodeNum(String(row[idx['Paycode']] || ''));
    const postType   = row[idx['Post Type']];
    const postDate   = row[idx['Post Date']];

    if (!empId || !paycodeNum) continue;

    const leaveTypeId = PAYCODE_TO_LEAVE_TYPE[paycodeNum];
    if (!leaveTypeId) continue;

    const action = POST_TYPE_TO_ACTION[postType];
    if (!action) { skippedNoAction++; continue; }

    // Collect all DB employee IDs that map to this XLS empId (write to both on collision)
    const byCode = empByCode.get(empId);
    const byWms  = empByWms.get(empId);
    const employeeIds = [...new Set([byWms, byCode].filter(Boolean))];
    if (employeeIds.length === 0) { skippedEmp++; continue; }

    const availBal    = Number(row[idx['Available Balance']]) || 0;
    const accrualHrs  = Number(row[idx['Accrual Hours']]) || 0;
    const usedHrs     = Number(row[idx['Used Hours']]) || 0;
    const adjustHrs   = Number(row[idx['Adjust Hours']]) || 0;
    const note        = row[idx['Notes']]?.trim() || null;

    // Deduplicate (per original empId, not per DB employee — prevents double-counting dupes)
    const dupeKey = `${empId}|${paycodeNum}|${postDate}|${postType}|${availBal}`;
    if (seen.has(dupeKey)) { skippedDupe++; continue; }
    seen.add(dupeKey);

    const deltaMinutes  = Math.round((accrualHrs - usedHrs + adjustHrs) * 60);
    const balanceAfter  = Math.round(availBal * 60);
    const createdAt     = parseDate(postDate) ?? new Date();

    for (const employeeId of employeeIds) {
      ledgerRows.push({
        employeeId,
        leaveTypeId,
        action,
        deltaMinutes,
        balanceAfter,
        note,
        createdAt,
        // payPeriodEnd drives the "Accrued" query (filters by year); set to post date
        payPeriodEnd: createdAt,
      });
    }
  }

  console.log(`Rows to write: ${ledgerRows.length}`);
  console.log(`  Skipped (emp not in DB): ${skippedEmp}`);
  console.log(`  Skipped (duplicates):    ${skippedDupe}`);
  console.log(`  Skipped (unknown type):  ${skippedNoAction}`);

  // Sort by createdAt so ledger is chronological
  ledgerRows.sort((a, b) => a.createdAt - b.createdAt);

  // Insert in batches of 500
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < ledgerRows.length; i += BATCH) {
    await db.leaveAccrualLedger.createMany({ data: ledgerRows.slice(i, i + BATCH) });
    written += Math.min(BATCH, ledgerRows.length - i);
    process.stdout.write(`  wrote ${Math.min(i + BATCH, ledgerRows.length)} / ${ledgerRows.length}\r`);
  }

  console.log(`\nDone. Ledger entries written: ${written}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
