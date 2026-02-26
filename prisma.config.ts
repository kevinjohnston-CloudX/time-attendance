import path from "node:path";
import { defineConfig } from "prisma/config";
import { config } from "dotenv";

// Load .env.local (Next.js convention) for Prisma CLI tools
config({ path: path.resolve(process.cwd(), ".env.local") });

export default defineConfig({
  schema: path.join("prisma", "schema"),
  datasource: {
    // Session pooler (port 5432) — used by prisma migrate/push
    // Falls back to placeholder so `prisma generate` works without a DB URL (e.g. on Vercel install)
    url: process.env.DIRECT_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
