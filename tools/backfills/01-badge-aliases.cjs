/*
 * Seeds employee_badges from the 2026-09-21 Oracle wmsusers export.
 *
 * The sync will do this by itself on its next run IF the bridge query returns
 * one row per card. It may well return one row per employee, in which case the
 * spare cards never arrive and this is the only thing that puts them there —
 * so it is run explicitly rather than assumed.
 *
 * Dry run by default. --apply writes.
 */
const fs = require('fs');
const REPO = require('path').resolve(__dirname, '../..');
const { Pool } = require(REPO + '/node_modules/pg');
require(REPO + '/node_modules/dotenv').config({ path: REPO + '/.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

// header: EMP_ID,BARCODE. barcode == empid is Oracle's "no separate card".
const cards = new Map();
for (const line of fs.readFileSync('C:/Users/cristian.rendon/Downloads/barcodes.csv', 'utf8').split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const [emp, bar] = line.split(',').map((x) => (x || '').trim().replace(/^\uFEFF/, '').replace(/^"|"$/g, ''));
  if (!emp || !bar || emp === bar) continue;
  if (!/^\d+$/.test(bar)) continue;          // GUIDs, "bergen", "TEMP1"
  if (!cards.has(emp)) cards.set(emp, new Set());
  cards.get(emp).add(bar);
}

async function main() {
  const emps = (await pool.query(
    `SELECT id, "wmsId", barcode FROM employees WHERE "wmsId" IS NOT NULL`)).rows;
  const byWms = new Map(emps.map((e) => [e.wmsId, e]));

  // Every card we intend to record: the primary already stored, plus Oracle's.
  const want = new Map();                     // barcode -> employeeId
  const clash = [];
  const add = (bar, e) => {
    const prior = want.get(bar);
    if (prior && prior !== e.id) { clash.push({ bar, a: prior, b: e.id }); return; }
    want.set(bar, e.id);
  };
  for (const e of emps) if (e.barcode) add(e.barcode, e);
  for (const [emp, set] of cards) {
    const e = byWms.get(emp);
    if (!e) continue;                         // not a CloudTime employee
    for (const bar of set) add(bar, e);
  }

  const existing = new Set(
    (await pool.query(`SELECT barcode FROM employee_badges`).catch(() => ({ rows: [] }))).rows.map((r) => r.barcode));
  const toInsert = [...want].filter(([bar]) => !existing.has(bar));

  console.log(`oracle export ....... ${cards.size} empids with alternate cards`);
  console.log(`cloudtime employees . ${emps.length} with a wmsId`);
  console.log(`cards to record ..... ${want.size}  (already present: ${existing.size})`);
  console.log(`to insert ........... ${toInsert.length}`);
  console.log(`clashes ............. ${clash.length}`);
  for (const c of clash) console.log('   CLASH ' + JSON.stringify(c));

  // What this actually buys: scans that currently resolve to nobody.
  const bars = toInsert.map(([b]) => b);
  const padded = bars.flatMap((b) => [b, b.padStart(10, '0')]);
  const gain = await pool.query(
    `SELECT count(*)::int AS scans, count(DISTINCT "badgeCode")::int AS badges,
            min(to_char("scanTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York','MM-DD')) AS first,
            max(to_char("scanTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York','MM-DD')) AS last
       FROM scan_events
      WHERE "sourceSlot"='LIVE' AND "employeeId" IS NULL AND "badgeCode" = ANY($1::text[])`, [padded]);
  console.log(`\nunattributed scans these cards would resolve: ${JSON.stringify(gain.rows[0])}`);

  if (clash.length) { console.log('\nREFUSING: a card claimed by two people. Resolve first.'); return; }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. re-run with --apply'); return; }

  // id is generated here because cuid() lives in the Prisma client, not the db.
  const { randomUUID } = require('crypto');
  const rows = toInsert.map(([bar, empId]) => [randomUUID(), empId, bar]);
  const ph = rows.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}, 'ORACLE', now(), now())`).join(',');
  const res = await pool.query(
    `INSERT INTO employee_badges (id, "employeeId", barcode, source, "syncedAt", "createdAt")
     VALUES ${ph} ON CONFLICT (barcode) DO NOTHING`, rows.flat());
  console.log(`\nAPPLIED: ${res.rowCount} card(s) recorded`);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
