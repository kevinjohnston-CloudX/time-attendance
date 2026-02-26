import path from "node:path";
import { defineConfig, env } from "prisma/config";
import { config } from "dotenv";

// Load .env.local (Next.js convention) for Prisma CLI tools
config({ path: path.resolve(process.cwd(), ".env.local") });

export default defineConfig({
  schema: path.join("prisma", "schema"),
  datasource: {
    // Session pooler (port 5432) — used by prisma migrate
    url: env("DIRECT_URL"),
  },
});
