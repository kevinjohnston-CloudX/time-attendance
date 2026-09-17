import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient, ExceptionType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/"), ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const now = new Date();

  const currentPeriod = await db.payPeriod.findFirst({
    where: { ruleSetId: { not: null }, status: "OPEN", startDate: { lte: now } },
    orderBy: { startDate: "desc" },
    select: { startDate: true, endDate: true, tenantId: true },
  });

  if (!currentPeriod) {
    console.log("No open pay period found — nothing to clear.");
    return;
  }

  console.log(`Current pay period starts: ${currentPeriod.startDate.toISOString()}`);
  console.log(`Clearing unresolved exceptions from pay periods that ended before that date...\n`);

  // Count first
  const toResolve = await db.exception.findMany({
    where: {
      resolvedAt: null,
      exceptionType: { in: Object.values(ExceptionType) },
      timesheet: {
        payPeriod: { endDate: { lt: currentPeriod.startDate } },
      },
    },
    select: { id: true, exceptionType: true, timesheet: { select: { payPeriod: { select: { startDate: true } } } } },
  });

  if (toResolve.length === 0) {
    console.log("No past-period exceptions to clear.");
    return;
  }

  // Show breakdown by type
  const byType: Record<string, number> = {};
  for (const ex of toResolve) {
    byType[ex.exceptionType] = (byType[ex.exceptionType] ?? 0) + 1;
  }
  console.log("Breakdown by type:");
  for (const [type, cnt] of Object.entries(byType).sort()) {
    console.log(`  ${type}: ${cnt}`);
  }
  console.log(`\nTotal: ${toResolve.length} exceptions\n`);

  const { count } = await db.exception.updateMany({
    where: {
      resolvedAt: null,
      exceptionType: { in: Object.values(ExceptionType) },
      timesheet: {
        payPeriod: { endDate: { lt: currentPeriod.startDate } },
      },
    },
    data: {
      resolvedAt: now,
      resolution: "Cleared — prior pay period",
    },
  });

  console.log(`Done. ${count} exceptions marked resolved.`);
}

main().catch(console.error).finally(() => pool.end());
