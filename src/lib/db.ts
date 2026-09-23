import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const connectionString = process.env.DATABASE_URL;

  // Supabase's pooler speaks TLS with a certificate this client does not
  // verify. A database on this machine usually has TLS switched off entirely,
  // and asking for it there fails the connection outright, so local work never
  // gets as far as a query.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString ?? "");

  // Transaction pooler (port 6543) — used at runtime by the app
  const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
