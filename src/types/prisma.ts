import type { db } from "@/lib/db";

/**
 * Transaction client type — the Prisma client passed into $transaction callbacks.
 * Use this when a utility function needs to participate in an outer transaction.
 */
export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];
