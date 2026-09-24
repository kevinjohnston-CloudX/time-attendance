/**
 * Adds agencyId FK column to employees table.
 * Run: npx tsx scripts/add-agency-fk-to-employees.ts
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "agencyId" TEXT`);
    const { rows } = await pool.query(`
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_employees_agency' AND table_name = 'employees'
    `);
    if (rows.length === 0) {
      await pool.query(`
        ALTER TABLE employees
          ADD CONSTRAINT fk_employees_agency
            FOREIGN KEY ("agencyId") REFERENCES agencies(id) ON DELETE SET NULL
      `);
    }
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_employees_agencyId"
        ON employees ("agencyId") WHERE "agencyId" IS NOT NULL;
    `);
    console.log("agencyId column added to employees.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
