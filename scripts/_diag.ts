import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/"), ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
async function main() {
  const periods = await db.payPeriod.findMany({
    where: { ruleSetId: { not: null }, endDate: { lt: new Date() } },
    orderBy: { endDate: "desc" },
    select: { id: true, startDate: true, endDate: true, ruleSetId: true },
    take: 20,
  });
  const seen = new Set<string>();
  for (const p of periods) {
    const key = `${p.startDate.toISOString()} → ${p.endDate.toISOString()}`;
    if (!seen.has(key)) { seen.add(key); console.log(key); }
  }
  console.log("Now:", new Date().toISOString());
}
main().catch(console.error).finally(async () => { await db.$disconnect(); await pool.end(); });
