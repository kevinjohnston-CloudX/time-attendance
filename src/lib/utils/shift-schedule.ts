import type { Prisma } from "@prisma/client";
import type { DayScheduleRow } from "@/actions/shift.actions";

type ShiftLike = {
  startTime: string;
  endTime: string;
  daySchedule: Prisma.JsonValue | null;
};

/**
 * The hours somebody was supposed to work on one particular day.
 *
 * <p>A shift carries both a headline start and end and an optional per-day
 * schedule, and the two disagree on purpose: a shift that runs 06:00 to 14:00
 * Monday to Thursday and 06:00 to 10:00 on Friday stores the short Friday in
 * the day rows only. Reading the headline times for every day would put a
 * four-hour Friday an hour past its own end.
 *
 * <p>A day the schedule marks as not worked comes back empty rather than
 * falling through to the headline times, because "scheduled 06:00 to 14:00"
 * on somebody's rest day is a statement the timecard does not support.
 */
export function scheduledWindow(
  shift: ShiftLike | null | undefined,
  date: Date,
): { start: string | null; end: string | null } {
  if (!shift) return { start: null, end: null };

  const rows = Array.isArray(shift.daySchedule)
    ? (shift.daySchedule as unknown as DayScheduleRow[])
    : null;
  const row = rows?.find((r) => r && r.day === date.getDay());

  if (row) {
    if (!row.isWorkday) return { start: null, end: null };
    if (row.startTime && row.endTime) return { start: row.startTime, end: row.endTime };
  }

  return { start: shift.startTime, end: shift.endTime };
}
