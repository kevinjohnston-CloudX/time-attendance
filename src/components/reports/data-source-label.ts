import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clock,
  FileText,
  History,
  Hourglass,
  TriangleAlert,
} from "lucide-react";
import type { ElementType } from "react";

/**
 * What a data source is called, and what it is drawn as, on a report screen.
 *
 * <p>The authoritative definitions live in `@/lib/reports/data-sources`, but
 * every source there carries an `execute` that reaches for Prisma, so a client
 * component importing that registry would drag the database client into the
 * browser bundle. This is the presentation half of it and nothing else, shared
 * by the list, the viewer and the builder. The names match the registry's.
 *
 * <p>Named for what the report answers, in the words HR uses, rather than
 * for the table it reads: "Time off requests", not "Leave Summary".
 */

const LABELS: Record<string, string> = {
  HOURS_SUMMARY:     "Hours summary",
  ATTENDANCE_DETAIL: "Daily attendance",
  DAILY_HOURS:       "Daily hours",
  EXCEPTION_REPORT:  "Exceptions",
  PUNCH_AUDIT:       "Punch audit",
  LEAVE_SUMMARY:     "Time off requests",
  LEAVE_BALANCE:     "Time off balances",
};

/** One plain line on what each report shows, for the Standard reports cards. */
const DESCRIPTIONS: Record<string, string> = {
  HOURS_SUMMARY:     "Regular, overtime and double time hours for each employee, with their PTO balance.",
  ATTENDANCE_DETAIL: "Each day's clock in and clock out times, meals and hours worked.",
  DAILY_HOURS:       "One line per employee per day, with regular, overtime and double time hours, time off and pay codes.",
  EXCEPTION_REPORT:  "Missed punches, absences and other rule breaks, and whether they were fixed.",
  PUNCH_AUDIT:       "Every punch, where it came from, and any corrections or approvals.",
  LEAVE_SUMMARY:     "Time off requests with their type, dates, length and status.",
  LEAVE_BALANCE:     "How much time off each employee has earned, used and has left.",
};

const ICONS: Record<string, ElementType> = {
  HOURS_SUMMARY:     Clock,
  ATTENDANCE_DETAIL: CalendarClock,
  DAILY_HOURS:       CalendarDays,
  EXCEPTION_REPORT:  TriangleAlert,
  PUNCH_AUDIT:       History,
  LEAVE_SUMMARY:     CalendarRange,
  LEAVE_BALANCE:     Hourglass,
};

/** The order the Standard reports cards are laid out in: hours first, time off last. */
export const STANDARD_REPORTS = [
  "HOURS_SUMMARY",
  "ATTENDANCE_DETAIL",
  "DAILY_HOURS",
  "EXCEPTION_REPORT",
  "PUNCH_AUDIT",
  "LEAVE_SUMMARY",
  "LEAVE_BALANCE",
] as const;

/** The one line under a report's name. */
export function dataSourceDescription(id: string): string {
  return DESCRIPTIONS[id] ?? "";
}

/**
 * The human name of a data source.
 *
 * <p>An unknown id is title-cased rather than printed raw: a source added to
 * the registry and not to this map then reads "Overtime Summary" instead of
 * putting OVERTIME_SUMMARY in front of a payroll admin.
 */
export function dataSourceLabel(id: string): string {
  return (
    LABELS[id] ??
    id
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** The glyph a data source is drawn with. Unknown sources get a document. */
export function dataSourceIcon(id: string): ElementType {
  return ICONS[id] ?? FileText;
}

/** Every source that has a name here, for a filter dropdown. */
export function dataSourceOptions(): { value: string; label: string }[] {
  return Object.entries(LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The colour a report type's icon sits in, by what it is about: hours and
 * attendance in blue, rule breaks in amber, the punch trail in grey, time off
 * in green. Semantic tokens only, so both themes follow.
 */
const TONES: Record<string, { bg: string; fg: string }> = {
  HOURS_SUMMARY:     { bg: "var(--surface-info)", fg: "var(--icon-accent)" },
  ATTENDANCE_DETAIL: { bg: "var(--surface-info)", fg: "var(--icon-accent)" },
  DAILY_HOURS:       { bg: "var(--surface-info)", fg: "var(--icon-accent)" },
  EXCEPTION_REPORT:  { bg: "var(--surface-warning)", fg: "var(--icon-warning)" },
  PUNCH_AUDIT:       { bg: "var(--surface-tertiary)", fg: "var(--icon-secondary)" },
  LEAVE_SUMMARY:     { bg: "var(--surface-success)", fg: "var(--icon-success)" },
  LEAVE_BALANCE:     { bg: "var(--surface-success)", fg: "var(--icon-success)" },
};

export function dataSourceTone(id: string): { bg: string; fg: string } {
  return TONES[id] ?? { bg: "var(--surface-tertiary)", fg: "var(--icon-secondary)" };
}

/** The standard reports in the two groups the picker draws them under. */
export const REPORT_GROUPS: { title: string; ids: readonly string[] }[] = [
  { title: "Hours and attendance", ids: ["HOURS_SUMMARY", "ATTENDANCE_DETAIL", "DAILY_HOURS", "EXCEPTION_REPORT", "PUNCH_AUDIT"] },
  { title: "Time off", ids: ["LEAVE_SUMMARY", "LEAVE_BALANCE"] },
];
