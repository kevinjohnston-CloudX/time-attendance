/*
 * Attribute the scans CloudTime recorded before it knew the badge.
 *
 * Sets employeeId and nothing else. outcome stays NO_EMPLOYEE and direction
 * stays UNKNOWN because both are true statements about what happened at the
 * time, roster-sync counts NO_EMPLOYEE rows as evidence when it assigns a
 * barcode, and recomputing an ALTERNATION direction five days late would be a
 * guess dressed as a record.
 *
 * Matches on employees.barcode, which is UNIQUE, so a badge resolves to at
 * most one person. Run with --apply to write; default is a dry run.
 */
const REPO = require('path').resolve(__dirname, '../..');
const { Pool } = require(REPO + '/node_modules/pg');
require(REPO + '/node_modules/dotenv').config({ path: REPO + '/.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');

const TARGET = `
  FROM scan_events se
  JOIN employees e ON e.barcode = se."badgeCode"
 WHERE se."employeeId" IS NULL AND se."sourceSlot" = 'LIVE'`;

async function main() {
  const before = (await pool.query(
    `SELECT count(*)::int AS rows, count(DISTINCT e.id)::int AS people,
            count(DISTINCT se."badgeCode")::int AS badges ${TARGET}`)).rows[0];
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${JSON.stringify(before)}`);

  console.log('\nper day / stream:');
  for (const r of (await pool.query(
    `SELECT to_char(se."scanTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York','MM-DD') AS day,
            se.stream, count(*)::int AS n ${TARGET}
      GROUP BY 1,2 ORDER BY 1,2`)).rows) console.log('  ' + JSON.stringify(r));

  // A badge that resolves to two people would make this ambiguous. barcode is
  // UNIQUE so it cannot, but assert rather than assume.
  const amb = (await pool.query(
    `SELECT se."badgeCode", count(DISTINCT e.id)::int AS n ${TARGET}
      GROUP BY 1 HAVING count(DISTINCT e.id) > 1`)).rows;
  if (amb.length) { console.error('\nAMBIGUOUS, refusing:', amb); process.exitCode = 1; return; }
  console.log('\nambiguous badges: 0');

  if (!APPLY) { console.log('\nnothing written. re-run with --apply'); return; }

  const r = await pool.query(
    `UPDATE scan_events se SET "employeeId" = e.id
       FROM employees e
      WHERE e.barcode = se."badgeCode"
        AND se."employeeId" IS NULL AND se."sourceSlot" = 'LIVE'`);
  console.log(`\nupdated ${r.rowCount} rows`);

  const after = (await pool.query(
    `SELECT count(*)::int AS "stillUnattributed" ${TARGET}`)).rows[0];
  const left = (await pool.query(
    `SELECT count(*)::int AS "trulyUnknownBadges" FROM scan_events se
      WHERE se."employeeId" IS NULL AND se."sourceSlot" = 'LIVE'`)).rows[0];
  console.log(JSON.stringify({ ...after, ...left }));
}
main().catch((e) => { console.error(e.stack); process.exitCode = 1; }).finally(() => pool.end());
