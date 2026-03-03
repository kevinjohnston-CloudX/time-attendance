import { addDays, differenceInDays, startOfMonth, endOfMonth } from "date-fns";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import type { PayFrequency } from "@prisma/client";

/**
 * Given a frequency + anchor, return the pay period that contains `date`.
 * For SEMIMONTHLY / MONTHLY the anchor is unused (calendar-based).
 */
export function getPeriodContaining(
  frequency: PayFrequency,
  anchor: Date,
  date: Date
): { startDate: Date; endDate: Date } {
  switch (frequency) {
    case "WEEKLY": {
      const n = Math.floor(differenceInDays(date, anchor) / 7);
      const start = addDays(anchor, n * 7);
      return { startDate: start, endDate: addDays(start, 6) };
    }
    case "BIWEEKLY": {
      const n = Math.floor(differenceInDays(date, anchor) / 14);
      const start = addDays(anchor, n * 14);
      return { startDate: start, endDate: addDays(start, 13) };
    }
    case "SEMIMONTHLY": {
      if (date.getDate() <= 15) {
        return {
          startDate: new Date(date.getFullYear(), date.getMonth(), 1),
          endDate: new Date(date.getFullYear(), date.getMonth(), 15),
        };
      }
      return {
        startDate: new Date(date.getFullYear(), date.getMonth(), 16),
        endDate: endOfMonth(date),
      };
    }
    case "MONTHLY":
      return { startDate: startOfMonth(date), endDate: endOfMonth(date) };
  }
}

/**
 * Ensure `targetFutureCount` future OPEN pay periods exist for the given tenant.
 * "Future" means startDate > today. Returns the number of periods created.
 * Idempotent — skips a period if it already exists.
 */
export async function generatePeriodsForTenant(
  tenantId: string,
  targetFutureCount = 2
): Promise<number> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });

  if (!tenant?.payPeriodAnchorDate) return 0;

  const anchor = tenant.payPeriodAnchorDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let futureCount = await db.payPeriod.count({
    where: { tenantId, startDate: { gt: today } },
  });

  let created = 0;

  while (futureCount < targetFutureCount) {
    const last = await db.payPeriod.findFirst({
      where: { tenantId },
      orderBy: { endDate: "desc" },
    });

    const referenceDate = last ? addDays(last.endDate, 1) : today;
    const { startDate, endDate } = getPeriodContaining(tenant.payFrequency, anchor, referenceDate);

    const existing = await db.payPeriod.findFirst({
      where: { tenantId, startDate, endDate },
    });

    if (!existing) {
      const period = await db.payPeriod.create({
        data: { tenantId, startDate, endDate, status: "OPEN" },
      });

      await writeAuditLog({
        tenantId,
        actorId: null,
        entityType: "PAY_PERIOD",
        entityId: period.id,
        action: "CREATE",
        changes: { after: { startDate, endDate, frequency: tenant.payFrequency, source: "AUTO_CRON" } },
      });

      created++;
    }

    futureCount++;
  }

  return created;
}
