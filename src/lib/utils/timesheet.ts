import { db } from "@/lib/db";
import type { TxClient } from "@/types/prisma";

/**
 * Find an existing timesheet for the employee+payPeriod combo, or create one.
 * Uses upsert to avoid race conditions under concurrent requests.
 * Accepts optional transaction client for use inside $transaction blocks.
 */
export async function findOrCreateTimesheet(
  employeeId: string,
  payPeriodId: string,
  tx?: TxClient
) {
  const client = tx ?? db;
  return client.timesheet.upsert({
    where: { employeeId_payPeriodId: { employeeId, payPeriodId } },
    update: {},
    create: { employeeId, payPeriodId },
  });
}
