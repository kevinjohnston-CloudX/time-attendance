import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "@/lib/db";
async function main() {
  const sites = await db.site.findMany({ select: { id: true, name: true, timezone: true }, orderBy: { name: "asc" } });
  for (const s of sites) console.log(`${s.name.padEnd(20)} ${s.timezone}`);
  await db.$disconnect();
}
main();
