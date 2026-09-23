/**
 * Seeds all agencies from legacy data.
 * Run: npx tsx scripts/seed-agencies.ts
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
import { Pool } from "pg";
import { randomUUID } from "crypto";

const AGENCIES: { code: number; description: string }[] = [
  { code: 0,  description: "BERGEN" },
  { code: 1,  description: "UNASSIGNED" },
  { code: 14, description: "Lyneer NJ" },
  { code: 20, description: "Workforce Staffing" },
  { code: 21, description: "Wonolo" },
  { code: 22, description: "Randstad" },
  { code: 26, description: "Summit" },
  { code: 27, description: "Baron" },
  { code: 28, description: "Human Edge" },
  { code: 29, description: "Priority WF" },
  { code: 30, description: "Workforce Enterprise" },
  { code: 31, description: "Select Staffing" },
  { code: 32, description: "First Class Staffing" },
  { code: 33, description: "Production Personnel Solutions" },
  { code: 34, description: "General Staffing Services" },
  { code: 35, description: "National Labor Strategies" },
  { code: 36, description: "Lyneer (CA)" },
  { code: 37, description: "Hobji" },
  { code: 38, description: "Ultra Personnel (CA)" },
  { code: 39, description: "Robert Half" },
  { code: 40, description: "Spectrum" },
  { code: 44, description: "Bear Staffing" },
  { code: 45, description: "Spherion" },
  { code: 46, description: "Tempo Team (NL)" },
  { code: 47, description: "Olympia (NL)" },
  { code: 48, description: "Leading Staffing (CA)" },
  { code: 49, description: "MVP Staffing" },
  { code: 50, description: "ERG Staffing" },
  { code: 51, description: "Lyneer (PA)" },
  { code: 54, description: "Access Careers (CAN)" },
  { code: 56, description: "Direct People (NL)" },
  { code: 59, description: "4Works" },
  { code: 63, description: "Preferred Personnel Solutions (GA)" },
  { code: 64, description: "Open Work Staffing (GA)" },
  { code: 65, description: "Preferred Staffing Inc (GA)" },
  { code: 67, description: "YoungOnes" },
  { code: 68, description: "Prestatie (NL)" },
  { code: 70, description: "Spectrum Works" },
  // "AGE: Agency AGE" skipped — non-numeric code, cannot store in INT column
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
  try {
    const { rows: tenants } = await pool.query(`SELECT id FROM tenants LIMIT 1`);
    if (!tenants.length) throw new Error("No tenant found");
    const tenantId = tenants[0].id;

    const { rows: existing } = await pool.query(
      `SELECT count(*)::int AS cnt FROM agencies WHERE "tenantId" = $1`,
      [tenantId]
    );
    if (existing[0].cnt > 0) {
      console.log(`Tenant already has ${existing[0].cnt} agencies — aborting to avoid duplicates.`);
      console.log("Delete existing agencies first if you want to re-seed.");
      return;
    }

    const now = new Date().toISOString();
    for (const a of AGENCIES) {
      await pool.query(
        `INSERT INTO agencies (id, "tenantId", code, description, "laborRate", "chargeRate", "maxWorkHours", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 0, 0, 0, $5, $5)`,
        [randomUUID(), tenantId, a.code, a.description, now]
      );
    }
    console.log(`Inserted ${AGENCIES.length} agencies.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
