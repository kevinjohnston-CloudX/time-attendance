/**
 * Cross-reference the 159 badge IDs not found in Cloud Time (from compare-nova-punches)
 * against the HR employee import XLS to see which ones exist there and their status.
 *
 * Usage: node scripts/check-missing-vs-hr.cjs
 */

const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const NOVA_XLS  = 'C:/Users/john.raefski/Downloads/Cloud Time(NJIMENEZ)-229996-26857.xls';
const HR_XLS    = 'C:/Users/john.raefski/Downloads/Employees List HR.xls';
const HR_XLS_2  = 'C:/Users/john.raefski/Downloads/Employees List HR (1).xls';

// Paycodes to skip
const SKIP_PAYCODES = new Set([33]);

function parseDateStr(val) {
  if (!val) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function normalise(name) {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readSheet(path) {
  try {
    const wb = xlsx.readFile(path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    return xlsx.utils.sheet_to_json(ws, { defval: '' });
  } catch (e) {
    return null;
  }
}

async function main() {
  // ── Step 1: get the 159 missing badge IDs from nova XLS ──────────────────
  const novaWb = xlsx.readFile(NOVA_XLS);
  const novaWs = novaWb.Sheets[novaWb.SheetNames[0]];
  const novaRaw = xlsx.utils.sheet_to_json(novaWs, { header: 1, defval: '' });

  let headerIdx = 0;
  for (let i = 0; i < 10; i++) {
    if (novaRaw[i].join(' ').toLowerCase().includes('work date')) { headerIdx = i; break; }
  }
  const headers = novaRaw[headerIdx].map(h => String(h).trim().toLowerCase());
  const col = n => headers.findIndex(h => h === n);

  const novaByBadge = new Map(); // badgeId → name
  for (let i = headerIdx + 1; i < novaRaw.length; i++) {
    const row = novaRaw[i];
    const empCell = String(row[col('employee')] ?? '').trim();
    if (!empCell) continue;
    const paycodeRaw = String(row[col('paycode')] ?? '').trim();
    const pcMatch = paycodeRaw.match(/^(\d+)/);
    if (!pcMatch || SKIP_PAYCODES.has(parseInt(pcMatch[1], 10))) continue;
    const spaceIdx = empCell.indexOf(' ');
    const badgeId = spaceIdx > 0 ? empCell.slice(0, spaceIdx) : empCell;
    const name = spaceIdx > 0 ? empCell.slice(spaceIdx + 1).replace(/^\[|\]$/g, '').trim() : '';
    if (!novaByBadge.has(badgeId)) novaByBadge.set(badgeId, name);
  }

  // Badge IDs found in Cloud Time by wmsId
  const allBadgeIds = [...novaByBadge.keys()];
  const dbEmployees = await db.employee.findMany({
    where: { wmsId: { in: allBadgeIds } },
    select: { wmsId: true },
  });
  const foundWmsIds = new Set(dbEmployees.map(e => e.wmsId));
  const missingBadgeIds = new Set(allBadgeIds.filter(id => !foundWmsIds.has(id)));

  console.log(`\nMissing badge IDs to check: ${missingBadgeIds.size}\n`);

  // ── Step 2: load HR XLS(es) ──────────────────────────────────────────────
  const hrRows1 = readSheet(HR_XLS)   ?? [];
  const hrRows2 = readSheet(HR_XLS_2) ?? [];
  const hrRows  = [...hrRows1, ...hrRows2];

  if (hrRows.length === 0) { console.log('Could not read HR XLS files'); process.exit(1); }

  // Print HR column names so we can see what's available
  const hrCols = Object.keys(hrRows[0]);
  console.log('HR XLS columns:', hrCols.join(' | '), '\n');

  // Find which column looks like an employee/badge ID and which is name
  const idCol   = hrCols.find(c => /emp.*id|badge|employee.*no|emp.*no|id$/i.test(c)) ?? hrCols[0];
  const nameCol = hrCols.find(c => /name/i.test(c)) ?? hrCols[1];
  const statCol = hrCols.find(c => /status|active|term/i.test(c));
  const termCol = hrCols.find(c => /term.*date|separation/i.test(c));

  // Build HR lookup: normalised ID → row, and normalised name → row
  const hrById   = new Map();
  const hrByName = new Map();
  for (const row of hrRows) {
    const rawId = String(row[idCol] ?? '').trim().replace(/^0+/, ''); // strip leading zeros
    if (rawId) hrById.set(rawId, row);
    const norm = normalise(String(row[nameCol] ?? ''));
    if (norm) hrByName.set(norm, row);
  }

  // ── Step 3: match missing badges against HR ───────────────────────────────
  const inHR       = [];
  const notInHR    = [];

  for (const badgeId of missingBadgeIds) {
    const novaName = novaByBadge.get(badgeId) ?? '';
    // Try by ID first (strip leading zeros from both sides)
    let hrRow = hrById.get(badgeId.replace(/^0+/, ''));
    // Try by name if no ID match
    if (!hrRow) {
      // Nova format is "LAST, FIRST" — try normalised full string
      const normNova = normalise(novaName);
      hrRow = hrByName.get(normNova);
      // Also try flipped: "FIRSTNAME LASTNAME"
      if (!hrRow) {
        const parts = novaName.split(/,\s*/);
        if (parts.length === 2) {
          const flipped = normalise(`${parts[1].trim()} ${parts[0].trim()}`);
          hrRow = hrByName.get(flipped);
        }
      }
    }

    if (hrRow) {
      const status = statCol ? String(hrRow[statCol] ?? '').trim() : '';
      const termDate = termCol ? String(hrRow[termCol] ?? '').trim() : '';
      const hrName = String(hrRow[nameCol] ?? '').trim();
      inHR.push({ badgeId, novaName, hrName, status, termDate, hrRow });
    } else {
      notInHR.push({ badgeId, novaName });
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────
  // Group HR matches by status
  const active     = inHR.filter(r => /active|^a$/i.test(r.status) && !r.termDate);
  const terminated = inHR.filter(r => /term|inactive|^t$/i.test(r.status) || r.termDate);
  const other      = inHR.filter(r => !active.includes(r) && !terminated.includes(r));

  console.log(`=== IN HR XLS: ${inHR.length} / ${missingBadgeIds.size} ===\n`);

  if (active.length) {
    console.log(`ACTIVE (${active.length}) — in HR, not in Cloud Time:`);
    for (const r of active)
      console.log(`  ${r.badgeId.padEnd(10)} Nova: "${r.novaName}"   HR: "${r.hrName}"   status=${r.status}`);
    console.log();
  }

  if (terminated.length) {
    console.log(`TERMINATED / INACTIVE (${terminated.length}):`);
    for (const r of terminated)
      console.log(`  ${r.badgeId.padEnd(10)} Nova: "${r.novaName}"   HR: "${r.hrName}"   status=${r.status}  termDate=${r.termDate || 'n/a'}`);
    console.log();
  }

  if (other.length) {
    console.log(`OTHER STATUS (${other.length}):`);
    for (const r of other)
      console.log(`  ${r.badgeId.padEnd(10)} Nova: "${r.novaName}"   HR: "${r.hrName}"   status=${r.status}`);
    console.log();
  }

  if (notInHR.length) {
    console.log(`=== NOT IN HR XLS EITHER (${notInHR.length}) ===\n`);
    for (const r of notInHR)
      console.log(`  ${r.badgeId.padEnd(10)} "${r.novaName}"`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Missing from Cloud Time:  ${missingBadgeIds.size}`);
  console.log(`Found in HR XLS:          ${inHR.length}`);
  console.log(`  Active:                 ${active.length}`);
  console.log(`  Terminated/Inactive:    ${terminated.length}`);
  console.log(`  Other:                  ${other.length}`);
  console.log(`Not in HR XLS either:     ${notInHR.length}`);

  await db.$disconnect();
  await pool.end();
}

main().catch(console.error);
