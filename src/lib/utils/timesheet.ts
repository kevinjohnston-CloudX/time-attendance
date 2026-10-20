import { db } from "@/lib/db";
import type { TxClient } from "@/types/prisma";
import { assertActiveForChange } from "@/lib/inactive-timecards";

/**
 * Find an existing timesheet for the employee+payPeriod combo, or create one.
 * Uses upsert to avoid race conditions under concurrent requests.
 * Accepts optional transaction client for use inside $transaction blocks.
 *
 * <p>Never creates one for an inactive employee: whatever asks (a timecard
 * entry, leave, the salary job, a rule set move), the answer is the
 * inactive-timecard refusal. An existing one is still returned.
 */
export async function findOrCreateTimesheet(
  employeeId: string,
  payPeriodId: string,
  tx?: TxClient
) {
  const client = tx ?? db;
  const existing = await client.timesheet.findUnique({ where: { employeeId_payPeriodId: { employeeId, payPeriodId } } });
  if (existing) return existing;
  const employee = await client.employee.findUnique({ where: { id: employeeId }, select: { isActive: true } });
  assertActiveForChange(employee?.isActive ?? false);
  return client.timesheet.upsert({
    where: { employeeId_payPeriodId: { employeeId, payPeriodId } },
    update: {},
    create: { employeeId, payPeriodId },
  });
}
