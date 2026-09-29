import { addDays, differenceInCalendarDays, differenceInDays, startOfMonth, endOfMonth } from "date-fns";
import type { PayFrequency } from "@prisma/client";

/**
 * Pay period arithmetic with no database, so the settings screen can preview
 * exactly the periods the server will create from the same numbers.
 *
 * <p>The stored end date follows two conventions, kept as they are because
 * existing periods already use them: weekly and bi-weekly end on the next
 * period's first day, semi-monthly and monthly on their own last day.
 * lastDayOf turns either into the day a person would call the last one.
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

/** The last day inside the period, whichever end date convention it uses. */
export function lastDayOf(frequency: PayFrequency, endDate: Date): Date {
  return frequency === "WEEKLY" || frequency === "BIWEEKLY" ? addDays(endDate, -1) : endDate;
}

/** How many days the period covers, counting both ends. */
export function periodDays(frequency: PayFrequency, p: { startDate: Date; endDate: Date }): number {
  return differenceInCalendarDays(lastDayOf(frequency, p.endDate), p.startDate) + 1;
}
