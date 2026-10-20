import { addDays, addMonths } from "date-fns";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import type { PayFrequency, PayPeriod } from "@prisma/client";
import { getPeriodContaining, periodAfter } from "@/lib/pay-period-math";
import { periodDayRange } from "@/lib/pay-period-days";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";

export { getPeriodContaining };

/**
 * How far ahead pay periods are kept, so HR can open a timecard and enter time
 * off anywhere in the coming year. It was two periods, which stopped them at a
 * date about a month out (November 21 in October).
 */
export const PERIOD_MONTHS_AHEAD = 12;

/** The day the periods have to reach: today plus the months ahead. */
function periodsReachDate(monthsAhead: number): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return addMonths(today, monthsAhead);
}

/**
 * Puts approved time off on a period just created. Time off can be approved
 * for days no period covers yet; those days had nowhere to go, and nothing
 * added them once the period was made. Only people on the period's schedule:
 * the rule set's, or the company's for rule sets without their own.
 */
async function addTimeOffToNewPeriod(period: PayPeriod, frequency: PayFrequency): Promise<void> {
  const { firstDay, lastDay } = periodDayRange(period, frequency);
  const requests = await db.leaveRequest.findMany({
    where: {
      status: { in: ["APPROVED", "POSTED"] },
      startDate: { lte: new Date(`${lastDay}T23:59:59.999Z`) },
      endDate: { gte: new Date(`${firstDay}T00:00:00.000Z`) },
      employee: {
        tenantId: period.tenantId,
        // No timecard is made for someone who has left.
        isActive: true,
        ruleSet: period.ruleSetId
          ? { id: period.ruleSetId, payFrequency: { not: null }, payPeriodAnchorDate: { not: null } }
          : { OR: [{ payFrequency: null }, { payPeriodAnchorDate: null }] },
      },
    },
    select: { id: true },
  });
  for (const r of requests) {
    try {
      await syncLeaveSegments(r.id);
    } catch (err) {
      console.error("pay periods: time off not added to a new period", period.id, r.id, err);
    }
  }
}

/**
 * The company level period that comes after the latest one, which is what
 * Generate creates, or null while no anchor date is saved. Rule set periods
 * are left out: they follow their own schedule.
 */
export async function nextTenantPeriod(
  tenantId: string
): Promise<{ startDate: Date; endDate: Date; frequency: PayFrequency } | null> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });
  if (!tenant?.payPeriodAnchorDate) return null;

  const last = await db.payPeriod.findFirst({
    where: { tenantId, ruleSetId: null },
    orderBy: { endDate: "desc" },
    select: { endDate: true },
  });

  const frequency = tenant.payFrequency;
  const anchor = tenant.payPeriodAnchorDate;
  const next = last
    ? periodAfter(frequency, anchor, last.endDate)
    : getPeriodContaining(frequency, anchor, new Date());
  return { ...next, frequency };
}

/**
 * Ensure the tenant's OPEN pay periods reach `monthsAhead` months past today,
 * with approved time off put on each new one. Returns the number of periods
 * created. Idempotent — skips a period if it already exists.
 */
export async function generatePeriodsForTenant(
  tenantId: string,
  monthsAhead = PERIOD_MONTHS_AHEAD
): Promise<number> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });

  if (!tenant?.payPeriodAnchorDate) return 0;

  const anchor = tenant.payPeriodAnchorDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reach = periodsReachDate(monthsAhead);

  let created = 0;

  // A cap on the loop, should a period ever fail to move the end forward.
  for (let guard = 0; guard < 120; guard++) {
    const last = await db.payPeriod.findFirst({
      where: { tenantId },
      orderBy: { endDate: "desc" },
    });
    if (last && last.endDate >= reach) break;

    // Advance one day past last.endDate so getPeriodContaining lands in the NEXT period,
    // regardless of whether last.endDate used the old inclusive or new exclusive convention.
    const referenceDate = last ? addDays(last.endDate, 1) : today;
    const period = getPeriodContaining(tenant.payFrequency, anchor, referenceDate);
    const endDate = period.endDate;
    let startDate = period.startDate;

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
      await addTimeOffToNewPeriod(period, tenant.payFrequency);

      created++;
    } else {
      // Already there yet not the latest by its end: nothing further to make.
      break;
    }
  }

  return created;
}

/**
 * Ensure the rule set's OPEN pay periods reach `monthsAhead` months past
 * today, with approved time off put on each new one.
 * Only runs when the rule set has its own payFrequency and payPeriodAnchorDate configured.
 * Idempotent — skips a period if it already exists (checked by ruleSetId + dates).
 */
export async function generatePeriodsForRuleSet(
  ruleSetId: string,
  tenantId: string,
  monthsAhead = PERIOD_MONTHS_AHEAD
): Promise<number> {
  const ruleSet = await db.ruleSet.findUnique({
    where: { id: ruleSetId },
    select: { payFrequency: true, payPeriodAnchorDate: true },
  });

  if (!ruleSet?.payFrequency || !ruleSet.payPeriodAnchorDate) return 0;

  const anchor = ruleSet.payPeriodAnchorDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reach = periodsReachDate(monthsAhead);

  let created = 0;

  // A cap on the loop, should a period ever fail to move the end forward.
  for (let guard = 0; guard < 120; guard++) {
    const last = await db.payPeriod.findFirst({
      where: { ruleSetId },
      orderBy: { endDate: "desc" },
    });
    if (last && last.endDate >= reach) break;

    const referenceDate = last ? addDays(last.endDate, 1) : today;
    const period = getPeriodContaining(ruleSet.payFrequency, anchor, referenceDate);
    const endDate = period.endDate;
    let startDate = period.startDate;

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
      await addTimeOffToNewPeriod(period, ruleSet.payFrequency);

      created++;
    } else {
      // Already there yet not the latest by its end: nothing further to make.
      break;
    }
  }

  return created;
}
