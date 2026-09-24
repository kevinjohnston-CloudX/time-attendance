/**
 * One-time backfill: creates an EmployeeRuleSetHistory record for every employee
 * using their current ruleSetId and hireDate as the effective date.
 *
 * This ensures the segment builder's history lookup always finds a record for
 * every calendar day, so existing timesheets are unaffected by the new logic.
 *
 * Safe to re-run — skips employees who already have at least one history record.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const employees = await db.employee.findMany({
    select: { id: true, ruleSetId: true, hireDate: true },
  });

  const existing = await db.employeeRuleSetHistory.findMany({
    select: { employeeId: true },
  });
  const alreadyHasHistory = new Set(existing.map(r => r.employeeId));

  const toCreate = employees
    .filter(e => !alreadyHasHistory.has(e.id))
    .map(e => ({
      id: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      employeeId: e.id,
      ruleSetId: e.ruleSetId,
      effectiveDate: e.hireDate,
    }));

  if (toCreate.length === 0) {
    console.log("All employees already have history records — nothing to do.");
    return;
  }

  await db.employeeRuleSetHistory.createMany({ data: toCreate });
  console.log(`Created ${toCreate.length} history records (${alreadyHasHistory.size} already existed).`);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
