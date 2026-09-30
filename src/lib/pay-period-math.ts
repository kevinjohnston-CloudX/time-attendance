import { addDays, differenceInCalendarDays, differenceInDays, startOfMonth } from "date-fns";
import type { PayFrequency } from "@prisma/client";

/**
 * Pay period arithmetic with no database, so the settings screen can preview
 * exactly the periods the server will create from the same numbers.
 *
 * <p>Every period made now stores its end as the next period's first day at
 * midnight. Semi-monthly and monthly periods made before September 30, 2026
 * stored their own last day instead, and they are kept as they are. lastDayOf
 * turns either into the day a person would call the last one.
 */

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
      // The end is the next period's first day at midnight, as weekly and
      // biweekly periods store theirs.
      if (date.getDate() <= 15) {
        return {
          startDate: new Date(date.getFullYear(), date.getMonth(), 1),
          endDate: new Date(date.getFullYear(), date.getMonth(), 16),
        };
      }
      return {
        startDate: new Date(date.getFullYear(), date.getMonth(), 16),
        endDate: new Date(date.getFullYear(), date.getMonth() + 1, 1),
      };
    }
    case "MONTHLY":
      return { startDate: startOfMonth(date), endDate: new Date(date.getFullYear(), date.getMonth() + 1, 1) };
  }
}

/**
 * The period that follows one ending at `endDate`, never overlapping it.
 *
 * <p>Steps from the day after the end, which lands in the next period under
 * both end date conventions. The loop only matters for a stored period whose
 * dates do not line up with the anchor, where the first step could still
 * start inside it.
 */
export function periodAfter(
  frequency: PayFrequency,
  anchor: Date,
  endDate: Date
): { startDate: Date; endDate: Date } {
  let next = getPeriodContaining(frequency, anchor, addDays(endDate, 1));
  for (let i = 0; i < 3 && differenceInCalendarDays(next.startDate, lastDayOf(frequency, endDate)) <= 0; i++) {
    next = getPeriodContaining(frequency, anchor, addDays(next.endDate, 1));
  }
  return next;
}

/**
 * The last day inside the period, whichever end date convention it uses.
 *
 * <p>A semi-monthly or monthly period is told apart by its end's day of the
 * month rather than its time: an old one ends on the 15th or the month's last
 * day, a new one on the 1st or the 16th, and those never overlap. The time of
 * day would not do, because an old first half period also ended at midnight.
 */
export function lastDayOf(frequency: PayFrequency, endDate: Date): Date {
  if (frequency === "WEEKLY" || frequency === "BIWEEKLY") return addDays(endDate, -1);
  const day = endDate.getDate();
  return day === 1 || day === 16 ? addDays(endDate, -1) : endDate;
}

/** How many days the period covers, counting both ends. */
export function periodDays(frequency: PayFrequency, p: { startDate: Date; endDate: Date }): number {
  return differenceInCalendarDays(lastDayOf(frequency, p.endDate), p.startDate) + 1;
}
