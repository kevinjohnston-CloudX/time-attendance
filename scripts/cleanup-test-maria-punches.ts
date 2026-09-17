import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/"),
  ssl: { rejectUnauthorized: false },
});
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  // Find Test Maria by employee code
  const employee = await db.employee.findFirst({
    where: { employeeCode: "102123" },
    select: { id: true, user: { select: { name: true } } },
  });

  if (!employee) {
    console.log("Employee 102123 not found.");
    return;
  }
  console.log(`Found: ${employee.user?.name} (${employee.id})\n`);

  // Find all MANUAL punches for this employee
  const manualPunches = await db.punch.findMany({
    where: { employeeId: employee.id, source: "MANUAL" },
    orderBy: { punchTime: "asc" },
    select: {
      id: true,
      punchType: true,
      punchTime: true,
      roundedTime: true,
      payCodeId: true,
      timesheetId: true,
    },
  });

  if (manualPunches.length === 0) {
    console.log("No MANUAL punches found — nothing to delete.");
    return;
  }

  console.log(`Found ${manualPunches.length} MANUAL punches:\n`);
  for (const p of manualPunches) {
    console.log(
      `  ${p.punchType.padEnd(12)} ${p.punchTime.toISOString()}  (${p.punchTime.toLocaleString("en-US", { timeZone: "America/New_York" })} ET)  ts=${p.timesheetId}`
    );
  }

  console.log("\nDeleting...");
  const { count } = await db.punch.deleteMany({
    where: { employeeId: employee.id, source: "MANUAL" },
  });
  console.log(`Deleted ${count} MANUAL punches.`);

  // Also clean up any stale WORK segments not tied to a leave request
  // (LEAVE segments with leaveRequestId are preserved by Recalculate, so leave those)
  const timesheetIds = [...new Set(manualPunches.map((p) => p.timesheetId).filter(Boolean) as string[])];
  if (timesheetIds.length > 0) {
    const { count: segCount } = await db.workSegment.deleteMany({
      where: {
        timesheetId: { in: timesheetIds },
        leaveRequestId: null,
        segmentType: "WORK",
      },
    });
    console.log(`Deleted ${segCount} stale WORK segments (LEAVE segments preserved).`);
  }

  console.log("\nDone. Click Recalculate on the timecard to rebuild segments from real punches.");
}

main().catch(console.error).finally(() => pool.end());
