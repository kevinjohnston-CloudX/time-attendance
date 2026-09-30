import { format } from "date-fns";
import type { PayFrequency } from "@prisma/client";
import { lastDayOf } from "@/lib/pay-period-math";
import { parseUtcDate } from "@/lib/utils/date";

/**
 * How a stored pay period reads on screen.
 *
 * <p>The stored end date follows two conventions (see lastDayOf in
 * pay-period-math): the next period's first day, for every period made now,
 * or the last day itself, for semi-monthly and monthly periods made before
 * September 30, 2026. Taking a day off every end date, as Pay Periods used
 * to, showed those older monthly periods a day short ("Sep 1 to Sep 29").
 * The frequency to pass is the period's rule set's, or the company's for a
 * company period.
 */

export const FREQ_LABEL: Record<PayFrequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMIMONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
};

/** The last calendar day inside the period, as a local date at midnight. */
export function periodLastDay(endDate: Date | string, frequency: PayFrequency): Date {
  return lastDayOf(frequency, parseUtcDate(endDate));
}

/** "Sep 1 to Sep 30, 2026", with the start's year only when the years differ. */
export function periodRange(startDate: Date | string, lastDay: Date): string {
  const start = parseUtcDate(startDate);
  const startFmt = start.getFullYear() === lastDay.getFullYear() ? "MMM d" : "MMM d, yyyy";
  return `${format(start, startFmt)} to ${format(lastDay, "MMM d, yyyy")}`;
}

/** A date as a yyyy-MM-dd key, for comparing calendar days without times. */
export function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}
