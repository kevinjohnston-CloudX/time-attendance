import type { Prisma } from "@prisma/client";

/**
 * The hours somebody is expected at work on one day, for Live Attendance.
 *
 * <p>Two sources can answer, and they often disagree. The shift on the
 * employee record came from the NovaTime and ADP export (the Employee Profile
 * spreadsheet) and is what the business says the person works. The day from
 * WMS (`schedule_days`, pulled from Oracle every few minutes) is what the
 * security gate checks. The shift wins, the same as on the
 * Exceptions page, and WMS is the fallback for anybody the shift cannot
 * answer for: no shift at all, or a rotating or dynamic shift whose day this
 * does not work out.
 *
 * <p>A shift that does not cover the day answers "not scheduled" rather than
 * falling back, because that is what the shift says. The WMS day is still
 * returned beside it so the panel can show what the gate will do.
 */

export const SHIFT_HOURS_SELECT = {
  startTime: true,
  endTime: true,
  workDays: true,
  daySchedule: true,
  shiftCycle: true,
  shiftType: true,
} as const;

export type ShiftHours = {
  startTime: string;
  endTime: string;
  workDays: number[];
  daySchedule: Prisma.JsonValue | null;
  shiftCycle: string;
  shiftType: string;
};

export type WmsDay = { startTime: string | null; endTime: string | null };

export type ExpectedHours = {
  start: string | null;
  end: string | null;
  source: "SHIFT" | "WMS";
};

type DayRow = { day?: unknown; isWorkday?: unknown; startTime?: unknown; endTime?: unknown };

/**
 * What the shift says about one site calendar day (YYYY-MM-DD): its hours,
 * null for a day it does not work, or undefined when it cannot say.
 */
export function shiftHoursOn(
  shift: ShiftHours | null | undefined,
  day: string,
): { start: string; end: string } | null | undefined {
  if (!shift || shift.shiftCycle !== "WEEKLY" || shift.shiftType !== "FIXED") return undefined;
  // Noon UTC of the calendar day is that same weekday everywhere in the Americas.
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  const rows = Array.isArray(shift.daySchedule) ? (shift.daySchedule as DayRow[]) : null;
  const row = rows?.find((r) => r && r.day === weekday);
  if (row) {
    if (row.isWorkday !== true) return null;
    if (typeof row.startTime === "string" && typeof row.endTime === "string" && row.startTime && row.endTime) {
      return { start: row.startTime, end: row.endTime };
    }
    return { start: shift.startTime, end: shift.endTime };
  }
  return shift.workDays.includes(weekday) ? { start: shift.startTime, end: shift.endTime } : null;
}

/** The hours to draw for one person on one day, or null when nobody expects them. */
export function expectedHours(
  shift: ShiftHours | null | undefined,
  wms: WmsDay | undefined,
  day: string,
): ExpectedHours | null {
  const fromShift = shiftHoursOn(shift, day);
  if (fromShift !== undefined) return fromShift ? { ...fromShift, source: "SHIFT" } : null;
  return wms ? { start: wms.startTime, end: wms.endTime, source: "WMS" } : null;
}
