/*
 * Attributes scans that resolve through the badge alias table.
 *
 * 02 matched `employees.barcode` only, so the scans belonging to people whose
 * card lives in `employee_badges` — the whole point of that table — were left
 * unattributed. This is the same pass over the other column.
 *
 * Same rules as 02: sets employeeId and nothing else, leaves outcome and
 * direction alone because both are true statements about what happened at the
 * time, and refuses outright if any badge is claimed by two people.
 *
 * Dry run by default. --apply writes.
 */
const REPO = require('path').resolve(__dirname, '../..');
const { Pool } = require(REPO + '/node_modules/pg');
require(REPO + '/node_modules/dotenv').config({ path: REPO + '/.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const APPLY = process.argv.includes('--apply');
const t = (r) => (r.length ? r.map((x) => '  ' + JSON.stringify(x)).join('\n') : '  (none)');

// Oracle stores barcodes unpadded; the tablets pad them to ten characters. Both
// forms are compared, which is the same reconciliation badge-lookup does at
// query time rather than by rewriting what either system stored.
const JOIN = `
  JOIN employee_badges b
    ON b.barcode = se."badgeCode"
    OR b.barcode = regexp_replace(se."badgeCode", '^0+', '')
    OR lpad(b.barcode, 10, '0') = se."badgeCode"`;
const WHERE = ` WHERE se."employeeId" IS NULL AND se."sourceSlot" = 'LIVE'`;

async function main() {
  console.log(t((await pool.query(
    `SELECT count(*)::int AS rows,
            count(DISTINCT b."employeeId")::int AS people,
            count(DISTINCT se."badgeCode")::int AS badges
       FROM scan_events se ${JOIN} ${WHERE}`)).rows));

  const amb = await pool.query(
    `SELECT se."badgeCode", count(DISTINCT b."employeeId")::int AS claimants
       FROM scan_events se ${JOIN} ${WHERE}
      GROUP BY 1 HAVING count(DISTINCT b."employeeId") > 1`);
  console.log(`\nambiguous badges: ${amb.rows.length}`);
  if (amb.rows.length) {
    console.log(t(amb.rows));
    console.log('\nREFUSING: a badge claimed by two people. Resolve first.');
    return;
  }

  console.log('\nwho this covers:');
  console.log(t((await pool.query(
    `SELECT u.name, se."badgeCode", count(*)::int AS scans
       FROM scan_events se ${JOIN}
       JOIN employees e ON e.id = b."employeeId"
       LEFT JOIN users u ON u.id = e."userId"
       ${WHERE}
      GROUP BY 1, 2 ORDER BY scans DESC LIMIT 20`)).rows));

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. re-run with --apply');
    return;
  }

  const res = await pool.query(
    `UPDATE scan_events se SET "employeeId" = b."employeeId"
       FROM employee_badges b
      WHERE (b.barcode = se."badgeCode"
             OR b.barcode = regexp_replace(se."badgeCode", '^0+', '')
             OR lpad(b.barcode, 10, '0') = se."badgeCode")
        AND se."employeeId" IS NULL AND se."sourceSlot" = 'LIVE'`);
  console.log(`\nAPPLIED: ${res.rowCount} rows attributed`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
