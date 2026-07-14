import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter } as never);

  try {
    const users = await (db as {
      user: {
        findMany: (args: object) => Promise<Array<{
          id: string; name: string | null; username: string | null;
          employee: { employeeCode: string } | null;
        }>>;
      };
    }).user.findMany({
      where: { email: null, isSuperAdmin: false },
      select: { id: true, name: true, username: true, employee: { select: { employeeCode: true } } },
    });

    if (users.length === 0) {
      console.log("All non-super-admin users have emails set.");
    } else {
      console.log(`${users.length} user(s) missing email:`);
      for (const u of users) {
        console.log(` - ${u.name ?? "(no name)"} | code: ${u.employee?.employeeCode ?? "no employee"} | username: ${u.username}`);
      }
    }
  } finally {
    await (db as { $disconnect: () => Promise<void> }).$disconnect();
    pool.end();
  }
}

main().catch(console.error);
