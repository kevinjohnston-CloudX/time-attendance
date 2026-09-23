import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "employee_ruleset_history" (
        "id"            TEXT        NOT NULL,
        "employeeId"    TEXT        NOT NULL,
        "ruleSetId"     TEXT        NOT NULL,
        "effectiveDate" DATE        NOT NULL,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdById"   TEXT,
        CONSTRAINT "employee_ruleset_history_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log("Created table employee_ruleset_history");

    await client.query(`
      CREATE INDEX IF NOT EXISTS "employee_ruleset_history_employeeId_effectiveDate_idx"
        ON "employee_ruleset_history"("employeeId", "effectiveDate");
    `);
    console.log("Created index");

    // Add FKs inside DO blocks so re-running is safe
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'employee_ruleset_history_employeeId_fkey'
        ) THEN
          ALTER TABLE "employee_ruleset_history"
            ADD CONSTRAINT "employee_ruleset_history_employeeId_fkey"
            FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'employee_ruleset_history_ruleSetId_fkey'
        ) THEN
          ALTER TABLE "employee_ruleset_history"
            ADD CONSTRAINT "employee_ruleset_history_ruleSetId_fkey"
            FOREIGN KEY ("ruleSetId") REFERENCES "rule_sets"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'employee_ruleset_history_createdById_fkey'
        ) THEN
          ALTER TABLE "employee_ruleset_history"
            ADD CONSTRAINT "employee_ruleset_history_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "employees"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    console.log("Added foreign key constraints");

    console.log("\nDone. Table employee_ruleset_history is ready.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
