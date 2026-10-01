import type { PayFrequency } from "@prisma/client";
import { dayKey, periodLastDay } from "@/lib/pay-period-display";
import { snapToLocalTime } from "@/lib/utils/date";

/**
 * A pay period as calendar days, and those days as moments in a site's time.
 *
 * <p>A period is a run of whole calendar days: 9/13 to 9/26 means from
 * midnight starting Sunday 9/13 to midnight ending Saturday 9/26, wherever the
 * employee works. The stored dates do not say that on their own. Weekly and
 * biweekly periods have been stored at 17:00 UTC on their first day and on the
 * next period's first day, which read as instants put the boundary at 1 PM
 * Eastern on the Sunday: Sunday morning hours went to the period before, and
 * one Sunday shift could be cut in two. So the stored dates are read for their
 * calendar day only, and the boundary is that day's midnight at the site.
 */

const nextDayKey = (k: string) => new Date(Date.parse(k + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);

/** First and last calendar day ("yyyy-MM-dd"), whichever way the dates were stored. */
export function periodDayRange(
  period: { startDate: Date | string; endDate: Date | string },
  frequency: PayFrequency,
): { firstDay: string; lastDay: string } {
  const start = typeof period.startDate === "string" ? new Date(period.startDate) : period.startDate;
  return {
    // The stored start's UTC date is its calendar day under every convention
    // in use (UTC midnight, local midnight Eastern, 17:00 UTC).
    firstDay: start.toISOString().slice(0, 10),
    lastDay: dayKey(periodLastDay(period.endDate, frequency)),
  };
}

/**
 * The period's bounds as moments: its first day's local midnight at the site,
 * and the local midnight after its last day (exclusive). These are what a punch
 * or a segment is compared with.
 */
export function periodBoundsInZone(
  period: { startDate: Date | string; endDate: Date | string },
  frequency: PayFrequency,
  timezone: string,
): { start: Date; end: Date; firstDay: string; lastDay: string } {
  const { firstDay, lastDay } = periodDayRange(period, frequency);
  return {
    start: snapToLocalTime("00:00", firstDay, timezone),
    end: snapToLocalTime("00:00", nextDayKey(lastDay), timezone),
    firstDay,
    lastDay,
  };
}

/**
 * The period's days as date-only values (UTC midnight), the form @db.Date
 * columns take, with an exclusive end, for code that walks the days.
 */
export function periodDateBounds(
  period: { startDate: Date | string; endDate: Date | string },
  frequency: PayFrequency,
): { start: Date; endExclusive: Date } {
  const { firstDay, lastDay } = periodDayRange(period, frequency);
  return { start: new Date(firstDay + "T00:00:00Z"), endExclusive: new Date(nextDayKey(lastDay) + "T00:00:00Z") };
}

/** Whether a moment falls on one of the period's days, at the site. */
export function periodContains(
  period: { startDate: Date | string; endDate: Date | string },
  frequency: PayFrequency,
  at: Date,
  timezone: string,
): boolean {
  const { firstDay, lastDay } = periodDayRange(period, frequency);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);
  return day >= firstDay && day <= lastDay;
}
