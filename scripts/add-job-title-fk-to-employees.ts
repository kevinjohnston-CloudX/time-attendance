/**
 * Adds job_title_id FK column to employees table, linking to job_titles.
 *
 * Run: npx tsx scripts/add-job-title-fk-to-employees.ts
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    connectionString: process.env.DIRECT_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Check if column already exists
    const check = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'employees' AND column_name = 'jobTitleId'`
    );

    if (check.rows.length > 0) {
      console.log("Column jobTitleId already exists — skipping.");
      return;
    }

    await pool.query(`
      ALTER TABLE employees
        ADD COLUMN "jobTitleId" TEXT,
        ADD CONSTRAINT fk_employees_job_title
          FOREIGN KEY ("jobTitleId") REFERENCES job_titles(id)
          ON DELETE SET NULL;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_employees_jobTitleId"
        ON employees ("jobTitleId")
        WHERE "jobTitleId" IS NOT NULL;
    `);

    console.log("Migration complete: jobTitleId column added to employees.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
