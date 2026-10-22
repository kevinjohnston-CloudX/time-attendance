import type { PayFrequency } from "@prisma/client";
import { db } from "@/lib/db";
import { periodDayRange } from "@/lib/pay-period-days";
import type { DateRange } from "@/lib/validators/report.schema";

/**
 * "The current pay period" and "the previous pay period", worked out each
 * time a report runs, so a saved report keeps meaning this fortnight rather
 * than the one it was saved in. NovaTime opens nearly every report this way.
 *
 * <p>The saved pay period only says which pay group to follow: every group
 * has its own periods, weekly ones inside biweekly ones, so "current" is the
 * period running today in that same group.
 */

export type Moving = "current" | "previous";

export interface PeriodDays {
  id: string;
  /** yyyy-mm-dd, first day worked. */
  firstDay: string;
  /** yyyy-mm-dd, last day worked, included. */
  lastDay: string;
}

/**
 * The period running on `today` (yyyy-mm-dd), or the one before it. When no
 * period covers today (a gap in the calendar), the latest one that has
 * started stands in for "current".
 */
export function pickMovingPeriod<T extends PeriodDays>(periods: T[], which: Moving, today: string): T | undefined {
  const started = periods.filter((p) => p.firstDay <= today).sort((a, b) => a.firstDay.localeCompare(b.firstDay));
  const current = started.find((p) => p.lastDay >= today) ?? started.at(-1);
  if (which === "current") return current;
  if (!current) return undefined;
  return started.filter((p) => p.lastDay < current.firstDay).at(-1);
}

type PayPeriodRange = Extract<DateRange, { type: "payPeriod" }>;

/**
 * The saved range with its pay period swapped for the one that is current
 * (or previous) today in the same pay group. A range that does not move, or
 * whose pay period is gone, comes back as it was.
 */
export async function resolveMovingPayPeriod(range: PayPeriodRange, tenantId: string, today: string): Promise<PayPeriodRange> {
  if (!range.moving) return range;
  const anchor = await db.payPeriod.findFirst({
    where: { id: range.payPeriodId, tenantId },
    select: { ruleSetId: true },
  });
  if (!anchor) return range;

  const periods = await db.payPeriod.findMany({
    where: { tenantId, ruleSetId: anchor.ruleSetId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      ruleSet: { select: { payFrequency: true } },
      tenant: { select: { payFrequency: true } },
    },
    orderBy: { startDate: "desc" },
    // A year of weekly periods is plenty to find today's and the one before.
    take: 60,
  });
  const days = periods.map((p) => ({
    id: p.id,
    ...periodDayRange(p, (p.ruleSet?.payFrequency ?? p.tenant.payFrequency) as PayFrequency),
  }));
  const pick = pickMovingPeriod(days, range.moving, today);
  return pick ? { ...range, payPeriodId: pick.id } : range;
}

/**
 * The day the company's week starts (0 Sunday to 6 Saturday): the one most of
 * its active people's pay rules use. Bergen's start on Sunday, as its pay
 * periods do; with no rules on file, Monday.
 */
export async function tenantWeekStart(tenantId: string): Promise<number> {
  const rules = await db.ruleSet.findMany({
    where: { tenantId },
    select: { weekStartDay: true, _count: { select: { employees: { where: { isActive: true } } } } },
  });
  const people = new Map<number, number>();
  for (const r of rules) people.set(r.weekStartDay, (people.get(r.weekStartDay) ?? 0) + r._count.employees);
  const best = [...people.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best && best[1] > 0 ? best[0] : 1;
}
