import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) as any });

// Elina Uceta (101000) clocked out 2:42 PM ET on 9/20/2026
// EDT = UTC-4, so 2:42 PM ET = 18:42 UTC
const EMPLOYEE_CODE = "101000";
const CLOCK_OUT_UTC = new Date("2026-09-20T18:42:00.000Z");

async function main() {
  const emp = await db.employee.findFirst({
    where: {
      OR: [{ wmsId: EMPLOYEE_CODE }, { employeeCode: EMPLOYEE_CODE }],
    },
    select: {
      id: true,
      employeeCode: true,
      user: { select: { name: true } },
      site: { select: { name: true } },
      punches: {
        where: {
          punchTime: {
            gte: new Date("2026-09-20T04:00:00Z"),
            lt:  new Date("2026-09-21T04:00:00Z"),
          },
        },
        select: { id: true, punchTime: true, punchType: true },
        orderBy: { punchTime: "asc" },
      },
    },
  });

  if (!emp) {
    console.error("Employee not found:", EMPLOYEE_CODE);
    process.exit(1);
  }

  console.log(`Employee: ${emp.user.name} (${emp.employeeCode}) — ${emp.site.name}`);
  console.log("Existing punches on 9/20:");
  for (const p of emp.punches) {
    console.log(`  ${p.punchType} ${p.punchTime.toLocaleString("en-US", { timeZone: "America/New_York" })}`);
  }

  const alreadyHasOut = emp.punches.some(p => p.punchType === "CLOCK_OUT");
  if (alreadyHasOut) {
    console.log("\nAlready has a CLOCK_OUT punch — not adding duplicate.");
    process.exit(0);
  }

  // Find the timesheet for this employee on 9/20
  const timesheet = await db.timesheet.findFirst({
    where: {
      employeeId: emp.id,
      payPeriod: {
        startDate: { lte: new Date("2026-09-20") },
        endDate:   { gte: new Date("2026-09-20") },
      },
    },
    select: { id: true },
  });

  console.log(`\nTimesheet: ${timesheet?.id ?? "none"}`);
  console.log(`Adding CLOCK_OUT at ${CLOCK_OUT_UTC.toLocaleString("en-US", { timeZone: "America/New_York" })} ET...`);

  const punch = await db.punch.create({
    data: {
      employeeId:  emp.id,
      timesheetId: timesheet?.id ?? null,
      punchType:   "CLOCK_OUT",
      punchTime:   CLOCK_OUT_UTC,
      roundedTime: CLOCK_OUT_UTC,
      source:      "MANUAL",
      stateBefore: "CLOCKED_IN",
      stateAfter:  "CLOCKED_OUT",
      isApproved:  true,
      note:        "Added from Novatime XLS 9/20/2026 — missed clock-out",
    },
  });

  console.log(`✓ Created punch ${punch.id}`);
  console.log("\nRun recalculate on this timesheet to update hours.");

  await db.$disconnect();
  pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
