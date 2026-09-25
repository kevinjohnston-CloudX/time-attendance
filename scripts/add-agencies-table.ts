/**
 * Creates the agencies table.
 * Run: npx tsx scripts/add-agencies-table.ts
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agencies (
        id           TEXT        PRIMARY KEY,
        "tenantId"   TEXT        NOT NULL REFERENCES tenants(id),
        code         INTEGER     NOT NULL,
        description  TEXT        NOT NULL,
        "laborRate"  NUMERIC(10,6) NOT NULL DEFAULT 0,
        "chargeRate" NUMERIC(10,6) NOT NULL DEFAULT 0,
        "inactiveOn" TIMESTAMPTZ,
        "maxWorkHours" NUMERIC(8,2) NOT NULL DEFAULT 0,
        "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS "idx_agencies_tenantId" ON agencies ("tenantId");`);
    console.log("agencies table ready.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
