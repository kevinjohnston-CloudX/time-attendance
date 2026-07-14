import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter } as never);

  try {
    const employees = await (db as {
      employee: {
        findMany: (args: object) => Promise<Array<{
          role: string;
          customRoleId: string | null;
          user: { name: string | null; email: string | null };
        }>>;
      };
    }).employee.findMany({
      where: { user: { email: "john.raefski@cloudxsystems.net" } },
      select: { role: true, customRoleId: true, user: { select: { name: true, email: true } } },
    });

    if (employees.length === 0) {
      console.log("No employee record found for john.raefski@cloudxsystems.net");
    } else {
      for (const e of employees) {
        console.log(`Name: ${e.user.name}, Role: ${e.role}, CustomRoleId: ${e.customRoleId ?? "none"}`);
      }
    }
  } finally {
    await (db as { $disconnect: () => Promise<void> }).$disconnect();
    pool.end();
  }
}

main().catch(console.error);
