import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  const today = new Date();

  // Find the current pay period (contains today)
  const currentPeriod = await db.payPeriod.findFirst({
    where: {
      startDate: { lte: today },
      endDate: { gte: today },
    },
    select: { id: true, startDate: true, endDate: true },
  });

  if (!currentPeriod) {
    console.log("No current pay period found — aborting.");
    return;
  }

  console.log(`Current pay period: ${currentPeriod.startDate.toISOString().slice(0, 10)} – ${currentPeriod.endDate.toISOString().slice(0, 10)} (will stay OPEN)`);

  // All other pay periods (not the current one)
  const previousPeriods = await db.payPeriod.findMany({
    where: { id: { not: currentPeriod.id } },
    select: { id: true, startDate: true, endDate: true, status: true },
    orderBy: { startDate: "asc" },
  });

  if (previousPeriods.length === 0) {
    console.log("No previous pay periods found.");
    return;
  }

  console.log(`\nFound ${previousPeriods.length} previous pay period(s) to lock:`);
  for (const pp of previousPeriods) {
    console.log(`  ${pp.startDate.toISOString().slice(0, 10)} – ${pp.endDate.toISOString().slice(0, 10)} [${pp.status}]`);
  }

  const previousPeriodIds = previousPeriods.map((pp) => pp.id);

  // Lock the pay periods
  const lockedPeriods = await db.payPeriod.updateMany({
    where: { id: { in: previousPeriodIds } },
    data: { status: "LOCKED" },
  });
  console.log(`\nLocked ${lockedPeriods.count} pay period(s).`);

  // Lock the timesheets in those periods
  const lockedTimesheets = await db.timesheet.updateMany({
    where: {
      payPeriodId: { in: previousPeriodIds },
      status: { notIn: ["LOCKED", "PAYROLL_APPROVED"] },
    },
    data: { status: "LOCKED" },
  });
  console.log(`Locked ${lockedTimesheets.count} timesheet(s).`);

  // Find all timesheets in previous periods to clear exceptions
  const timesheets = await db.timesheet.findMany({
    where: { payPeriodId: { in: previousPeriodIds } },
    select: { id: true },
  });
  const timesheetIds = timesheets.map((ts) => ts.id);

  // Delete all exceptions for those timesheets
  const deletedExceptions = await db.exception.deleteMany({
    where: { timesheetId: { in: timesheetIds } },
  });
  console.log(`Deleted ${deletedExceptions.count} exception(s).`);

  console.log("\nDone.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
