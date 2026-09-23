/**
 * Creates the job_titles table and FK to tenants.
 * Safe to re-run — skips if table / index already exist.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_titles (
        id           TEXT        NOT NULL PRIMARY KEY,
        "tenantId"   TEXT        NOT NULL,
        name         TEXT        NOT NULL,
        "externalId" TEXT,
        "isActive"   BOOLEAN     NOT NULL DEFAULT true,
        "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS "job_titles_tenantId_idx"
        ON job_titles ("tenantId")
    `);

    await client.query(`
      DO $do$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'job_titles_tenantId_fkey'
        ) THEN
          ALTER TABLE job_titles
            ADD CONSTRAINT "job_titles_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES tenants(id);
        END IF;
      END $do$
    `);

    console.log("job_titles table ready.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
