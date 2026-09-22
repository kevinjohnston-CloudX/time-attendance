import { db } from "@/lib/db";

/**
 * The week and the schedule behind the portal design's Punch Clock screen.
 *
 * <p>Two numbers appear side by side on that screen — what you have worked and
 * what you were scheduled to work — and they come from completely different
 * places: worked hours from the segments the rules engine wrote, scheduled
 * hours from the shift's day schedule. Keeping the two derivations next to
 * each other is the only way to see that they agree on what a "day" is.
 */

export interface DaySchedule {
  /** 0 = Sunday. */
  day: number;
  isWorkday: boolean;
  startTime: string | null;
  endTime: string | null;
  mealMinutes: number;
}

export interface WeekDay {
  date: Date;
  label: string;
  workedMinutes: number;
  scheduledMinutes: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeekCard {
  days: WeekDay[];
  workedMinutes: number;
  scheduledMinutes: number;
}

export interface UpcomingShift {
  key: string;
  day: string;
  shift: string;
  hours: string;
  note: string;
  tone: "info" | "neutral";
}

/** Minutes between two "HH:mm" stamps, wrapping past midnight for night shifts. */
function spanMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins >= 0 ? mins : mins + 1440;
}

/**
 * The employee's schedule as seven rows, whichever way the shift stores it.
 *
 * <p>Shifts carry a per-day `daySchedule` JSON when someone has set one up, and
 * fall back to a single start/end plus a list of workDays when nobody has. The
 * fallback is not a detail: most shifts in this tenant use it, and a screen
 * that only read daySchedule would show everyone as scheduled for nothing.
 */
export function readSchedule(shift: {
  startTime: string;
  endTime: string;
  workDays: number[];
  daySchedule: unknown;
} | null): DaySchedule[] | null {
  if (!shift) return null;

  const rows = Array.isArray(shift.daySchedule) ? (shift.daySchedule as Record<string, unknown>[]) : null;
  if (rows && rows.length === 7) {
    return rows.map((r, i) => ({
      day: typeof r.day === "number" ? r.day : i,
      isWorkday: r.isWorkday === true,
      startTime: typeof r.startTime === "string" ? r.startTime : null,
      endTime: typeof r.endTime === "string" ? r.endTime : null,
      mealMinutes: typeof r.mealMinutes === "number" ? r.mealMinutes : 0,
    }));
  }

  return Array.from({ length: 7 }, (_, day) => ({
    day,
    isWorkday: shift.workDays.includes(day),
    startTime: shift.workDays.includes(day) ? shift.startTime : null,
    endTime: shift.workDays.includes(day) ? shift.endTime : null,
    mealMinutes: 0,
  }));
}

function scheduledFor(row: DaySchedule | undefined): number {
  if (!row || !row.isWorkday || !row.startTime || !row.endTime) return 0;
  return Math.max(0, spanMinutes(row.startTime, row.endTime) - row.mealMinutes);
}

/**
 * This week's worked hours per day, against what was scheduled.
 *
 * <p>Worked minutes come from WorkSegment, which is what the rules engine
 * produced and therefore what payroll will pay — deliberately not a second
 * count of the punches. Today is the exception: its last stretch has not
 * closed, so the caller passes in the live figure from the Today card rather
 * than showing a bar that lags the clock by an hour.
 */
export async function getWeek(
  employeeId: string,
  now: Date,
  todayLiveMinutes: number,
): Promise<WeekCard> {
  // Week starts Sunday, matching the 0-indexed workDays on Shift.
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [segments, employee] = await Promise.all([
    db.workSegment.findMany({
      where: {
        timesheet: { employeeId },
        segmentType: "WORK",
        isPaid: true,
        segmentDate: { gte: weekStart, lt: weekEnd },
      },
      select: { segmentDate: true, durationMinutes: true },
    }),
    db.employee.findUnique({
      where: { id: employeeId },
      select: {
        shift: { select: { startTime: true, endTime: true, workDays: true, daySchedule: true } },
      },
    }),
  ]);

  const schedule = readSchedule(employee?.shift ?? null);

  const workedByDate = new Map<string, number>();
  for (const s of segments) {
    const key = s.segmentDate.toISOString().slice(0, 10);
    workedByDate.set(key, (workedByDate.get(key) ?? 0) + s.durationMinutes);
  }

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const isToday = key === todayKey;
    return {
      date,
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      // Today's segments are still being written, so the live count wins.
      workedMinutes: isToday ? Math.max(todayLiveMinutes, workedByDate.get(key) ?? 0) : workedByDate.get(key) ?? 0,
      scheduledMinutes: scheduledFor(schedule?.[date.getDay()]),
      isToday,
      isFuture: date > now && !isToday,
    };
  });

  return {
    days,
    workedMinutes: days.reduce((n, d) => n + d.workedMinutes, 0),
    scheduledMinutes: days.reduce((n, d) => n + d.scheduledMinutes, 0),
  };
}

/**
 * The next five days this person is scheduled to work.
 *
 * <p>Walks forward from tomorrow rather than filtering a fixed window, because
 * someone on a three-day week would otherwise see one or two rows and assume
 * the rest of their schedule was missing.
 */
export async function getUpcomingShifts(employeeId: string, now: Date): Promise<UpcomingShift[]> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { shift: { select: { startTime: true, endTime: true, workDays: true, daySchedule: true } } },
  });

  const schedule = readSchedule(employee?.shift ?? null);
  if (!schedule) return [];

  const out: UpcomingShift[] = [];
  for (let offset = 1; offset <= 21 && out.length < 5; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const row = schedule[date.getDay()];
    const minutes = scheduledFor(row);
    if (minutes === 0) continue;

    out.push({
      key: date.toISOString().slice(0, 10),
      day: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      shift: `${row.startTime} – ${row.endTime}${row.mealMinutes ? ` · ${row.mealMinutes}m meal` : ""}`,
      hours: (minutes / 60).toFixed(2),
      note: offset === 1 ? "Tomorrow" : "Scheduled",
      tone: offset === 1 ? "info" : "neutral",
    });
  }
  return out;
}
