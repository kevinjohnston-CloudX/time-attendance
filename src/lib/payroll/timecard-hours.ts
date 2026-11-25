/**
 * A timecard's hours, worked out one way for every screen and report.
 *
 * <p>The timecard keeps its hours twice: the lines (one per block of time) and
 * saved totals written when the hours are calculated. The saved totals fall
 * behind whenever a line changes afterwards (a worked day recoded as FMLA,
 * leave added later), so screens reading them disagreed with the timecard.
 * Everything that shows a person's hours for a period counts the lines here
 * instead, with the timecard page's own rules, so the numbers are the same
 * wherever they are read.
 *
 * <p>The rules, as the timecard page has always shown them and payroll
 * confirmed against NovaTime (Nov 25, 2026):
 * <ul>
 *   <li>Regular counts straight time under every code: worked regular plus
 *       PTO, sick, holiday, FMLA and the other leave codes, as NovaTime's
 *       Reg Hrs does.</li>
 *   <li>A code set to Not paid (FMLA) stays in the hours and is counted again
 *       in {@code notPaid}, so a report can say those hours carry no pay. The
 *       ADP file leaves them out.</li>
 *   <li>Meal premium is pay, not hours worked: kept out of Regular and Total.</li>
 *   <li>A day with an open missed punch is left out until the punch is fixed.</li>
 * </ul>
 *
 * <p>Pure: no database, safe in the browser. The server side reader is
 * {@link ./timecard-hours.server}.
 */
import { format } from "date-fns";
import { parseUtcDate, toSiteClock } from "@/lib/utils/date";

/** Leave codes counted inside Regular, as NovaTime's Reg Hrs counts them. */
export const PAID_LEAVE_BUCKETS: ReadonlySet<string> = new Set([
  "PTO", "SICK", "HOLIDAY", "FMLA", "BEREAVEMENT", "JURY_DUTY", "MILITARY",
]);

/** One line of a timecard, or several of the same kind on one day added up. */
export type HoursLine = {
  segmentType: string;
  payBucket: string;
  payBucketOverride: string | null;
  isPaid: boolean;
  /** The pay code's own Not paid setting, when the line carries a code. */
  payCodeIsPaid?: boolean | null;
  segmentDate: Date | string;
  /** Exact minutes, from the seconds column (leave holds hundredths of an hour). */
  durationMinutes: number;
};

/** A period's hours for one timecard, in minutes. */
export type TimecardHours = {
  /** Straight time under every code, leave included. */
  reg: number;
  ot: number;
  dt: number;
  /** Every counted hour: Regular, Overtime, Double and anything else. */
  total: number;
  /** The part of Regular that is leave (PTO, sick, FMLA...), not worked. */
  leave: number;
  /** Hours under a code set to Not paid. Already inside the figures above. */
  notPaid: number;
  /** Meal premium hours: pay owed, not hours worked. Outside Total. */
  premium: number;
  /** Total split by the code each hour is paid under (REG, OT, PTO, FMLA...). */
  byBucket: Record<string, number>;
  /** The part of each code's hours under a code set to Not paid. */
  notPaidByBucket: Record<string, number>;
  /**
   * Leave lines marked unpaid (Unpaid Time Off), by code. Outside Total, as
   * the timecard's Summary shows them in their own Unpaid column.
   */
  unpaidLeaveByBucket: Record<string, number>;
};

export const NO_HOURS: TimecardHours = {
  reg: 0, ot: 0, dt: 0, total: 0, leave: 0, notPaid: 0, premium: 0,
  byBucket: {}, notPaidByBucket: {}, unpaidLeaveByBucket: {},
};

/** A line's day, as the timecard grid files it. */
export function lineDay(segmentDate: Date | string): string {
  return format(parseUtcDate(segmentDate), "yyyy-MM-dd");
}

/**
 * The days an open missed punch leaves out, in the person's own time zone:
 * the day the timecard grid shows the missed punch on.
 */
export function missedPunchDays(
  exceptions: { exceptionType: string; occurredAt: Date | string }[],
  timeZone: string,
): Set<string> {
  return new Set(
    exceptions
      .filter((e) => e.exceptionType === "MISSING_PUNCH")
      .map((e) => format(toSiteClock(new Date(e.occurredAt), timeZone), "yyyy-MM-dd")),
  );
}

/** The pay code a line is paid under: a leave code set on a worked line wins. */
export function effectiveBucket(line: Pick<HoursLine, "payBucket" | "payBucketOverride">): string {
  const ov = line.payBucketOverride;
  return ov && ov !== "REG" && ov !== "OT" && ov !== "DT" ? ov : line.payBucket;
}

/** A timecard's hours from its lines. */
export function timecardHours(lines: Iterable<HoursLine>, skipDays: ReadonlySet<string>): TimecardHours {
  const byBucket: Record<string, number> = {};
  const notPaidByBucket: Record<string, number> = {};
  const unpaidLeaveByBucket: Record<string, number> = {};
  let premium = 0;
  let notPaid = 0;
  for (const s of lines) {
    if (skipDays.size > 0 && skipDays.has(lineDay(s.segmentDate))) continue;
    if (!s.isPaid) {
      if ((s.segmentType === "LEAVE" || s.segmentType === "HOLIDAY") && s.durationMinutes > 0) {
        const ub = effectiveBucket(s);
        unpaidLeaveByBucket[ub] = (unpaidLeaveByBucket[ub] ?? 0) + s.durationMinutes;
      }
      continue;
    }
    if (s.segmentType === "MEAL_PREMIUM") { premium += s.durationMinutes; continue; }
    const eb = effectiveBucket(s);
    byBucket[eb] = (byBucket[eb] ?? 0) + s.durationMinutes;
    if (s.payCodeIsPaid === false) {
      notPaid += s.durationMinutes;
      notPaidByBucket[eb] = (notPaidByBucket[eb] ?? 0) + s.durationMinutes;
    }
  }
  let leave = 0;
  for (const [k, v] of Object.entries(byBucket)) if (PAID_LEAVE_BUCKETS.has(k)) leave += v;
  return {
    reg: (byBucket["REG"] ?? 0) + leave,
    ot: byBucket["OT"] ?? 0,
    dt: byBucket["DT"] ?? 0,
    total: Object.values(byBucket).reduce((a, b) => a + b, 0),
    leave,
    notPaid,
    premium,
    byBucket,
    notPaidByBucket,
    unpaidLeaveByBucket,
  };
}

/** One day of a timecard grid, in minutes. */
export type DayHours = { reg: number; ot: number; dt: number; total: number };

/**
 * One day's figures as every timecard grid shows them (HR's timecard and the
 * employee's own): leave and holiday lines under Regular, a worked line
 * recoded to a leave code (FMLA) under its code, so in Total only, and meal
 * premium left out (it has its own line under the day).
 */
export function dayHours(lines: Iterable<Omit<HoursLine, "segmentDate"> & { segmentDate?: Date | string }>): DayHours {
  const buckets: Record<string, number> = {};
  let total = 0;
  for (const s of lines) {
    if (s.segmentType === "MEAL_PREMIUM") continue;
    const shown = s.segmentType === "HOLIDAY" || s.segmentType === "LEAVE" ? "REG" : effectiveBucket(s);
    buckets[shown] = (buckets[shown] ?? 0) + s.durationMinutes;
    if (s.isPaid) total += s.durationMinutes;
  }
  return { reg: buckets["REG"] ?? 0, ot: buckets["OT"] ?? 0, dt: buckets["DT"] ?? 0, total };
}
