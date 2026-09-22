import {
  AlertCircle,
  CalendarDays,
  Clock,
  FileSearch,
  FileText,
  Wallet,
} from "lucide-react";
import type { ElementType } from "react";

/**
 * What a data source is called, and what it is drawn as, on a report screen.
 *
 * <p>The authoritative definitions live in `@/lib/reports/data-sources`, but
 * every source there carries an `execute` that reaches for Prisma, so a client
 * component importing that registry would drag the database client into the
 * browser bundle. This is the presentation half of it and nothing else, shared
 * by the list, the viewer and the builder — those three had three copies of
 * the same label map, and they had already drifted apart on "Leave Balances".
 */

const LABELS: Record<string, string> = {
  HOURS_SUMMARY:     "Hours Summary",
  ATTENDANCE_DETAIL: "Attendance Detail",
  LEAVE_SUMMARY:     "Leave Summary",
  LEAVE_BALANCE:     "Leave Balances",
  PUNCH_AUDIT:       "Punch Audit",
  EXCEPTION_REPORT:  "Exception Report",
};

const ICONS: Record<string, ElementType> = {
  HOURS_SUMMARY:     Clock,
  ATTENDANCE_DETAIL: CalendarDays,
  LEAVE_SUMMARY:     CalendarDays,
  LEAVE_BALANCE:     Wallet,
  PUNCH_AUDIT:       FileSearch,
  EXCEPTION_REPORT:  AlertCircle,
};

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
