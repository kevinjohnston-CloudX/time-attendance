import type { DateRange } from "@/lib/validators/report.schema";
import { zonedParts } from "./schedule-time";

/**
 * The calendar days a report covers, for the reports that count scans.
 *
 * <p>Every answer is whole calendar days in a named time zone, as yyyy-mm-dd
 * strings with both ends included. "Yesterday" is therefore yesterday where
 * the people are, not yesterday in UTC, which for an evening shift is already
 * tomorrow. Weeks run Monday to Sunday.
 */

export interface DaySpan {
  /** First day, yyyy-mm-dd. */
  start: string;
  /** Last day, yyyy-mm-dd, included. */
  end: string;
}

export const REPORT_ZONE = "America/New_York";

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return fromUtc(Date.UTC(y, m - 1, d + n));
}

/** Today's date in a zone, yyyy-mm-dd. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  return key(p.year, p.month, p.day);
}

/**
 * The days a date range stands for. A pay period is not one of them: it is
 * measured per pay group, and these reports are about scans on days.
 */
export function daysOf(range: DateRange, timeZone: string = REPORT_ZONE, now: Date = new Date()): DaySpan {
  const today = todayIn(timeZone, now);
  const [ty, tm, td] = today.split("-").map(Number);

  switch (range.type) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case "relative":
      // The last N days, ending today, the way the other reports count them.
      return { start: addDays(today, -range.relativeDays), end: today };
    case "custom":
      return { start: range.startDate, end: range.endDate };
    case "calendar": {
      const last = range.which === "last";
      if (range.unit === "week") {
        const weekday = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay(); // 0 = Sunday
        const monday = addDays(today, -((weekday + 6) % 7) - (last ? 7 : 0));
        return { start: monday, end: addDays(monday, 6) };
      }
      if (range.unit === "month") {
        const first = Date.UTC(ty, tm - 1 - (last ? 1 : 0), 1);
        const nextFirst = Date.UTC(ty, tm - (last ? 1 : 0), 1);
        return { start: fromUtc(first), end: fromUtc(nextFirst - 86_400_000) };
      }
      const y = last ? ty - 1 : ty;
      return { start: key(y, 1, 1), end: key(y, 12, 31) };
    }
    case "payPeriod":
      throw new Error("This report is measured in calendar days. Pick dates instead of a pay period.");
  }
}

const SHORT = (day: string, withYear: boolean) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
};

/** "Oct 1, 2026" for one day, "Sep 1 to Sep 30, 2026" for several. */
export function describeSpan(span: DaySpan): string {
  if (span.start === span.end) return SHORT(span.start, true);
  return `${SHORT(span.start, span.start.slice(0, 4) !== span.end.slice(0, 4))} to ${SHORT(span.end, true)}`;
}

/** The days in a span, for counting. */
export function dayCount(span: DaySpan): number {
  const [y1, m1, d1] = span.start.split("-").map(Number);
  const [y2, m2, d2] = span.end.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}
