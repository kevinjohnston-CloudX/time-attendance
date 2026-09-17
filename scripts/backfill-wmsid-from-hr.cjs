/**
 * Set wmsId on employees where it is currently null, using the Nova XLS.
 *
 * Strategy: For each badge ID in the Nova XLS that has no matching wmsId in DB,
 * check if a DB employee has employeeCode === badge ID. If so, wmsId = badge ID.
 * (Many employees use their employee ID as their time-clock badge number.)
 *
 * Usage:
 *   node scripts/backfill-wmsid-from-hr.cjs --dry-run   [preview]
 *   node scripts/backfill-wmsid-from-hr.cjs              [apply]
 */

const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const NOVA_XLS = process.argv.find(a => a.endsWith('.xls') || a.endsWith('.xlsx'))
              ?? 'C:/Users/john.raefski/Downloads/Cloud Time(NJIMENEZ)-229996-26857.xls';
const SKIP_PAYCODES = new Set([33]);
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(DRY_RUN ? '\n=== DRY RUN ===' : '\n=== LIVE UPDATE ===');

  // ── Read Nova XLS, collect all badge IDs ──────────────────────────────────
  const wb = xlsx.readFile(NOVA_XLS);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

  let headerIdx = 0;
  for (let i = 0; i < 10; i++) {
    if (raw[i].join(' ').toLowerCase().includes('work date')) { headerIdx = i; break; }
  }
  const headers = raw[headerIdx].map(h => String(h).trim().toLowerCase());
  const col = n => headers.findIndex(h => h === n);

  const novaByBadge = new Map(); // badgeId → name
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
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

  const allBadgeIds = [...novaByBadge.keys()];
  console.log(`Nova badge IDs: ${allBadgeIds.length}`);

  // ── Find which badge IDs already have a DB match by wmsId ─────────────────
  const byWms = await db.employee.findMany({
    where: { wmsId: { in: allBadgeIds } },
    select: { wmsId: true },
  });
  const foundWmsIds = new Set(byWms.map(e => e.wmsId));
  const missingBadgeIds = allBadgeIds.filter(id => !foundWmsIds.has(id));
  console.log(`Badge IDs with no wmsId match: ${missingBadgeIds.length}`);

  // ── Try to match missing badges by employeeCode ───────────────────────────
  const byCode = await db.employee.findMany({
    where: {
      employeeCode: { in: missingBadgeIds },
      wmsId: null,
    },
    select: { id: true, employeeCode: true, user: { select: { name: true } } },
  });

  const codeMap = new Map(byCode.map(e => [e.employeeCode, e]));
  const toUpdate = [];
  const noMatch  = [];

  for (const badgeId of missingBadgeIds) {
    const emp = codeMap.get(badgeId);
    if (emp) {
      toUpdate.push({ id: emp.id, employeeCode: emp.employeeCode, badge: badgeId, name: emp.user.name });
    } else {
      noMatch.push({ badgeId, novaName: novaByBadge.get(badgeId) });
    }
  }

  console.log(`\nMatched by employeeCode → will set wmsId: ${toUpdate.length}`);
  console.log(`No DB match (not importable here): ${noMatch.length}`);

  if (noMatch.length) {
    console.log('\nNo match:');
    noMatch.forEach(r => console.log(`  badge=${r.badgeId}  Nova: "${r.novaName}"`));
  }

  if (DRY_RUN) {
    console.log('\nUpdates that would be applied:');
    toUpdate.forEach(u => console.log(`  ${u.employeeCode.padEnd(10)} "${u.name}" → wmsId = ${u.badge}`));
    console.log(`\nDry run complete. Re-run without --dry-run to apply.`);
    await db.$disconnect();
    await pool.end();
    return;
  }

  let updated = 0;
  for (const u of toUpdate) {
    await db.employee.update({ where: { id: u.id }, data: { wmsId: u.badge } });
    updated++;
  }
  console.log(`\nDone. wmsId set on ${updated} employees.`);
  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
