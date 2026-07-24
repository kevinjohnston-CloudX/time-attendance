import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  const cutoff = new Date("2026-07-01T00:00:00.000Z");

  // Find pay periods that end before July 2026
  const oldPeriods = await db.payPeriod.findMany({
    where: { endDate: { lt: cutoff } },
    select: { id: true, startDate: true, endDate: true },
    orderBy: { startDate: "asc" },
  });

  if (oldPeriods.length === 0) {
    console.log("No pre-July pay periods found.");
    return;
  }

  console.log(`Found ${oldPeriods.length} pay period(s) to delete:`);
  for (const pp of oldPeriods) {
    console.log(`  ${pp.startDate.toISOString().slice(0, 10)} – ${pp.endDate.toISOString().slice(0, 10)} (${pp.id})`);
  }

  const periodIds = oldPeriods.map((pp) => pp.id);

  // Find all timesheets in those periods
  const timesheets = await db.timesheet.findMany({
    where: { payPeriodId: { in: periodIds } },
    select: { id: true },
  });
  const timesheetIds = timesheets.map((ts) => ts.id);
  console.log(`\nFound ${timesheetIds.length} timesheet(s) to delete.`);

  if (timesheetIds.length > 0) {
    // Delete punch corrections first (self-referencing — nullify correctedById before deleting)
    const correctionCount = await db.punch.updateMany({
      where: { timesheetId: { in: timesheetIds }, correctedById: { not: null } },
      data: { correctedById: null },
    });
    console.log(`Nullified correctedById on ${correctionCount.count} punch(es).`);

    // Delete in dependency order
    const segments = await db.workSegment.deleteMany({ where: { timesheetId: { in: timesheetIds } } });
    console.log(`Deleted ${segments.count} work segment(s).`);

    const exceptions = await db.exception.deleteMany({ where: { timesheetId: { in: timesheetIds } } });
    console.log(`Deleted ${exceptions.count} exception(s).`);

    const buckets = await db.overtimeBucket.deleteMany({ where: { timesheetId: { in: timesheetIds } } });
    console.log(`Deleted ${buckets.count} overtime bucket(s).`);

    const waivers = await db.mealWaiver.deleteMany({ where: { timesheetId: { in: timesheetIds } } });
    console.log(`Deleted ${waivers.count} meal waiver(s).`);

    const notes = await db.timesheetNote.deleteMany({ where: { timesheetId: { in: timesheetIds } } });
    console.log(`Deleted ${notes.count} timesheet note(s).`);

    const dayReasons = await db.timesheetDayReason.deleteMany({ where: { timesheetId: { in: timesheetIds } } });
    console.log(`Deleted ${dayReasons.count} day reason(s).`);

    const punches = await db.punch.deleteMany({ where: { timesheetId: { in: timesheetIds } } });
    console.log(`Deleted ${punches.count} punch(es).`);

    const ts = await db.timesheet.deleteMany({ where: { id: { in: timesheetIds } } });
    console.log(`Deleted ${ts.count} timesheet(s).`);
  }

  // Delete payroll runs for these periods (if any)
  const runs = await db.payrollRun.deleteMany({ where: { payPeriodId: { in: periodIds } } });
  console.log(`Deleted ${runs.count} payroll run(s).`);

  // Finally delete the pay periods themselves
  const periods = await db.payPeriod.deleteMany({ where: { id: { in: periodIds } } });
  console.log(`Deleted ${periods.count} pay period(s).`);

  console.log("\nDone.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
