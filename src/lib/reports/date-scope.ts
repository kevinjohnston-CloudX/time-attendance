import { db } from "@/lib/db";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * What a report's dates mean, in one place, so the six reports stop
 * disagreeing about them.
 *
 * <p>A pay period belongs to one pay group, and every group has its own with
 * the same dates. "All pay groups" (allGroups) means every timesheet whose
 * pay period falls inside the picked one's dates, which also takes in a
 * weekly group's two weeks inside a biweekly fortnight. Without it, the
 * report keeps to the one pay period picked, as saved reports always have.
 *
 * <p>Picked dates are whole days: "to Sep 26" includes Sep 26. Pay periods
 * are compared by the day, not the moment: their stored bounds carry a time
 * of day (5:00 PM UTC on this tenant), and a stored end is the day after the
 * last day worked.
 */

type PayPeriodRange = Extract<ReportConfig["dateRange"], { type: "payPeriod" }>;

const DAY = 24 * 60 * 60 * 1000;

/** The day after the last picked day: the end, exclusive. */
export function dayAfter(isoDate: string): Date {
  return new Date(new Date(isoDate).getTime() + DAY);
}

/** Midnight UTC of the day a stored moment falls on. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * A PayPeriod where clause for the periods inside a run of days, given as
 * the first day and the day after the last one. A period ending on the day
 * after the last day is inside, whatever time of day it is stored at.
 */
export function payPeriodsInside(tenantId: string, firstDay: Date, dayAfterLast: Date): Record<string, unknown> {
  return {
    tenantId,
    startDate: { gte: utcDay(firstDay) },
    endDate: { lt: new Date(utcDay(dayAfterLast).getTime() + DAY) },
  };
}

/** The picked pay period's own dates, scoped to the tenant. */
export async function payPeriodSpan(range: PayPeriodRange, tenantId: string): Promise<{ start: Date; end: Date } | null> {
  const pp = await db.payPeriod.findFirst({
    where: { id: range.payPeriodId, tenantId },
    select: { startDate: true, endDate: true },
  });
  return pp ? { start: pp.startDate, end: pp.endDate } : null;
}

/**
 * A Timesheet where clause for a pay period range: the one period, or with
 * allGroups every period inside its dates. A period that is not the
 * tenant's matches nothing rather than everything.
 */
export async function timesheetPayPeriodWhere(range: PayPeriodRange, tenantId: string): Promise<Record<string, unknown>> {
  if (!range.allGroups) return { payPeriodId: range.payPeriodId, payPeriod: { tenantId } };
  const span = await payPeriodSpan(range, tenantId);
  if (!span) return { payPeriodId: "__none__" };
  return { payPeriod: payPeriodsInside(tenantId, span.start, span.end) };
}
