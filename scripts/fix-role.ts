import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter } as never);

  try {
    const result = await (db as {
      employee: {
        updateMany: (args: object) => Promise<{ count: number }>;
      };
    }).employee.updateMany({
      where: { user: { email: "john.raefski@cloudxsystems.net" } },
      data: { role: "SYSTEM_ADMIN" },
    });
    console.log(`Updated ${result.count} employee record(s) to SYSTEM_ADMIN`);
  } finally {
    await (db as { $disconnect: () => Promise<void> }).$disconnect();
    pool.end();
  }
}

main().catch(console.error);
