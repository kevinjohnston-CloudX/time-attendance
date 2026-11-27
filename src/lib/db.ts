import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient, type Prisma } from "@prisma/client";
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

const base = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = base;
}

/**
 * The transaction the current call chain runs in, when one is open
 * ({@link inTimecardTransaction}). Every `db` call made inside it, however deep,
 * goes to that transaction, so code written against `db` (the calculation
 * engine, 3,600 lines of it) becomes all or nothing without passing a
 * transaction through every function.
 */
const openTransaction = new AsyncLocalStorage<Prisma.TransactionClient>();

/**
 * The database. Outside a transaction it is the client itself. Inside one,
 * every model and raw query goes to that transaction, and `db.$transaction`
 * runs its work in it too: a list of queries one after another, a function
 * with the transaction (Postgres has no nested transactions, and the outer one
 * already makes it all or nothing).
 */
export const db: PrismaClient = new Proxy(base, {
  get(target, prop) {
    const tx = openTransaction.getStore();
    if (!tx) {
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
    if (prop === "$transaction") {
      return async (work: unknown) => {
        if (typeof work === "function") return (work as (t: Prisma.TransactionClient) => unknown)(tx);
        const results: unknown[] = [];
        for (const query of work as PromiseLike<unknown>[]) results.push(await query);
        return results;
      };
    }
    const value = Reflect.get(tx, prop, tx);
    return typeof value === "function" ? value.bind(tx) : value;
  },
});

/**
 * Runs `work` as one database transaction holding a lock on one timecard.
 *
 * <p>All or nothing: a recalculation is some twenty saves in a row, and one that
 * stopped part way (the database out of connections, a timeout) left the
 * timecard half rebuilt. On Oct 12 nine timecards kept their regular hours with
 * the overtime step never run. Now a failure leaves the timecard exactly as it
 * was, for the next recalculation to redo.
 *
 * <p>One at a time: a second recalculation of the same timecard (a punch, an HR
 * edit and the nightly job can meet) waits for the first to finish instead of
 * interleaving with it. Interleaved, five at once turned one timecard's 27 lines
 * into 333 on the test database. The lock is Postgres's own, released when the
 * transaction ends, so a crash never leaves it held.
 *
 * <p>Inside an open transaction it takes the lock there and runs in it.
 */
export async function inTimecardTransaction<T>(timesheetId: string, work: () => Promise<T>): Promise<T> {
  const lock = (tx: Prisma.TransactionClient) =>
    tx.$executeRawUnsafe("select pg_advisory_xact_lock(hashtext($1))", `timecard:${timesheetId}`);
  const current = openTransaction.getStore();
  if (current) {
    await lock(current);
    return work();
  }
  return base.$transaction(
    async (tx) => {
      await lock(tx);
      return openTransaction.run(tx, work);
    },
    // Waiting for a connection, then for the whole recalculation. A busy
    // timecard with leave takes about a second; two minutes is room for a slow
    // database, not a target.
    { maxWait: 20_000, timeout: 120_000 },
  );
}
