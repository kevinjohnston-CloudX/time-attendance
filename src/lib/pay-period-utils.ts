import { addDays, differenceInDays, startOfMonth } from "date-fns";
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
      return { startDate: start, endDate: addDays(start, 7) };
    }
    case "BIWEEKLY": {
      const n = Math.floor(differenceInDays(date, anchor) / 14);
      const start = addDays(anchor, n * 14);
      return { startDate: start, endDate: addDays(start, 14) };
    }
    case "SEMIMONTHLY": {
      // endDate is exclusive (midnight of the day after the last day), consistent with WEEKLY/BIWEEKLY.
      if (date.getDate() <= 15) {
        return {
          startDate: new Date(date.getFullYear(), date.getMonth(), 1),
          endDate: new Date(date.getFullYear(), date.getMonth(), 16), // midnight of the 16th
        };
      }
      return {
        startDate: new Date(date.getFullYear(), date.getMonth(), 16),
        endDate: new Date(date.getFullYear(), date.getMonth() + 1, 1), // midnight of 1st of next month
      };
    }
    case "MONTHLY":
      // endDate is exclusive (midnight of 1st of next month), consistent with WEEKLY/BIWEEKLY.
      return { startDate: startOfMonth(date), endDate: new Date(date.getFullYear(), date.getMonth() + 1, 1) };
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

    // Advance one day past last.endDate so getPeriodContaining lands in the NEXT period,
    // regardless of whether last.endDate used the old inclusive or new exclusive convention.
    const referenceDate = last ? addDays(last.endDate, 1) : today;
    let { startDate, endDate } = getPeriodContaining(tenant.payFrequency, anchor, referenceDate);

    // On a frequency/anchor change the calendar-based startDate may fall before the last
    // period's end (e.g. weekly → biweekly). Pin startDate forward to avoid overlap and
    // prevent double-paying periods that are already closed.
    if (last && startDate < last.endDate) {
      startDate = last.endDate;
    }

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

/**
 * Ensure `targetFutureCount` future OPEN pay periods exist for the given rule set.
 * Only runs when the rule set has its own payFrequency and payPeriodAnchorDate configured.
 * Idempotent — skips a period if it already exists (checked by ruleSetId + dates).
 */
export async function generatePeriodsForRuleSet(
  ruleSetId: string,
  tenantId: string,
  targetFutureCount = 2
): Promise<number> {
  const ruleSet = await db.ruleSet.findUnique({
    where: { id: ruleSetId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });

  if (!ruleSet?.payFrequency || !ruleSet.payPeriodAnchorDate) return 0;

  const anchor = ruleSet.payPeriodAnchorDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let futureCount = await db.payPeriod.count({
    where: { ruleSetId, startDate: { gt: today } },
  });

  let created = 0;

  while (futureCount < targetFutureCount) {
    const last = await db.payPeriod.findFirst({
      where: { ruleSetId },
      orderBy: { endDate: "desc" },
    });

    const referenceDate = last ? addDays(last.endDate, 1) : today;
    let { startDate, endDate } = getPeriodContaining(ruleSet.payFrequency, anchor, referenceDate);

    if (last && startDate < last.endDate) {
      startDate = last.endDate;
    }

    const existing = await db.payPeriod.findFirst({
      where: { ruleSetId, startDate, endDate },
    });

    if (!existing) {
      const period = await db.payPeriod.create({
        data: { tenantId, ruleSetId, startDate, endDate, status: "OPEN" },
      });

      await writeAuditLog({
        tenantId,
        actorId: null,
        entityType: "PAY_PERIOD",
        entityId: period.id,
        action: "CREATE",
        changes: { after: { startDate, endDate, frequency: ruleSet.payFrequency, ruleSetId, source: "AUTO_CRON" } },
      });

      created++;
    }

    futureCount++;
  }

  return created;
}
