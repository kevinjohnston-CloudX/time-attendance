import { db } from "@/lib/db";
import { checkPermission } from "@/lib/rbac/check-permission";
import { TIMECARD_EDITORS } from "@/lib/rbac/permissions";
import { dayAt } from "@/lib/timecards/change-note";
import { endedOn, startedOn } from "@/lib/engines/segment-builder";

/**
 * A missed punch fixed by somebody allowed nothing else on a timecard
 * (PUNCH_FIX_MISSED_TEAM: Bergen's supervisors, 11/05). HR wanted supervisors
 * to correct missed punches, under the regular hours pay code, and to leave
 * every other change (hours, pay codes, reason codes, meal waivers, changing
 * or removing a punch) to HR and payroll.
 *
 * <p>A fix is the one punch a shift is missing: a clock out after a clock in
 * left open, or a clock in before a clock out with none. The shift's day must
 * be one CloudTime has marked Missed punch, and the punch goes on that day, or
 * the next for a clock out after midnight (the previous for a clock in).
 *
 * <p>11/06: they may also fill a day marked Absent with one shift, a clock in
 * on that day and a clock out after it, that day or the next. Absent is the
 * timecard's own rule: a past weekday in the period, while employed, with no
 * punches, leave, holiday or pay code on it.
 */

export const MISSED_PUNCH_ONLY_ERROR =
  "You can only add the missing clock in or clock out on a day marked Missed punch, or one clock in and clock out on a day marked Absent. Ask HR or payroll for any other change to this timecard.";

export type AddedPunch = { punchType: "CLOCK_IN" | "CLOCK_OUT"; at: Date };
export type TimecardPunch = { punchType: string; roundedTime: Date };

function shiftDay(day: string, by: number): string {
  const d = new Date(day + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/**
 * Why these punches are not a missed punch fix, or null when each closes one.
 * `existing` is the timecard's approved, uncorrected punches; `missedDays` the
 * days ("yyyy-MM-dd" at the person's time zone) with an open missed punch;
 * `absentDays` the days marked Absent.
 */
export function missedPunchRefusal(
  added: AddedPunch[],
  existing: TimecardPunch[],
  missedDays: Set<string>,
  timeZone: string,
  absentDays: Set<string> = new Set(),
): string | null {
  if (fillsAbsentDay(added, existing, absentDays, timeZone)) return null;

  // One clock in and one clock out at most: two of a kind is a new shift.
  const types = added.map((p) => p.punchType);
  if (new Set(types).size !== types.length) return MISSED_PUNCH_ONLY_ERROR;

  const punches = [...existing].sort((a, b) => a.roundedTime.getTime() - b.roundedTime.getTime());
  for (const p of added) {
    const t = p.at.getTime();
    const before = punches.filter((e) => e.roundedTime.getTime() < t).at(-1) ?? null;
    const after = punches.find((e) => e.roundedTime.getTime() > t) ?? null;
    if (p.punchType === "CLOCK_OUT") {
      // Closes a shift left open: the punch before it is not a clock out, and
      // the next one, if any, starts another shift.
      if (!before || before.punchType === "CLOCK_OUT") return MISSED_PUNCH_ONLY_ERROR;
      if (after && after.punchType !== "CLOCK_IN") return MISSED_PUNCH_ONLY_ERROR;
      const day = dayAt(before.roundedTime, timeZone);
      const on = dayAt(p.at, timeZone);
      if (!missedDays.has(day) || (on !== day && on !== shiftDay(day, 1))) return MISSED_PUNCH_ONLY_ERROR;
    } else {
      // Opens a shift that has a clock out and no clock in.
      if (!after || after.punchType === "CLOCK_IN") return MISSED_PUNCH_ONLY_ERROR;
      if (before && before.punchType !== "CLOCK_OUT") return MISSED_PUNCH_ONLY_ERROR;
      const day = dayAt(after.roundedTime, timeZone);
      const on = dayAt(p.at, timeZone);
      if (!missedDays.has(day) || (on !== day && on !== shiftDay(day, -1))) return MISSED_PUNCH_ONLY_ERROR;
    }
  }
  return null;
}

/** One shift on a day marked Absent: its clock in that day, its clock out after it, that day or the next. */
function fillsAbsentDay(added: AddedPunch[], existing: TimecardPunch[], absentDays: Set<string>, timeZone: string): boolean {
  if (added.length !== 2) return false;
  const clockIn = added.find((p) => p.punchType === "CLOCK_IN");
  const clockOut = added.find((p) => p.punchType === "CLOCK_OUT");
  if (!clockIn || !clockOut || clockOut.at <= clockIn.at) return false;
  const day = dayAt(clockIn.at, timeZone);
  if (!absentDays.has(day)) return false;
  const outDay = dayAt(clockOut.at, timeZone);
  if (outDay !== day && outDay !== shiftDay(day, 1)) return false;
  // After midnight, nothing of the next day's in between.
  return !existing.some((e) => e.roundedTime >= clockIn.at && e.roundedTime <= clockOut.at);
}

/**
 * The timecard's Absent rule (timecard-viewer isAbsent), for one day: a
 * weekday before today, in the pay period, from their start to their last
 * day, with no punches and no segment at all (leave, holiday, a pay code put
 * on the absent day).
 */
export function isAbsentDay(
  day: string,
  o: { today: string; periodStart: string; periodEnd: string; startedOn: string; endedOn: string | null; punchDays: Set<string>; segmentDays: Set<string> },
): boolean {
  const weekday = new Date(day + "T12:00:00.000Z").getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (day >= o.today || day < o.periodStart || day > o.periodEnd) return false;
  if (day < o.startedOn || (o.endedOn && day > o.endedOn)) return false;
  return !o.punchDays.has(day) && !o.segmentDays.has(day);
}

/**
 * Add time, for a supervisor allowed only to fix missed punches (11/09): a
 * row of regular hours, clock in and out or a number of hours, on today or a
 * day before it, on an open timecard. No other pay code and no future day.
 * `day` and `today` are "yyyy-MM-dd" at the person's time zone;
 * `payCodeId` is the one asked for, if any, and `regularCodeId` the rule
 * set's regular hours code.
 */
export function addTimeRefusal(o: { status: string; day: string; today: string; payCodeId?: string | null; regularCodeId: string | null; hours?: number }): string | null {
  if (o.status !== "OPEN") return "You can add time only to an open timecard. Ask HR or payroll for this one.";
  if (o.day > o.today) return "You can't add time for a future date. Add it on the day, or after.";
  if (o.payCodeId && o.payCodeId !== o.regularCodeId) return "You can add time only as regular hours. Ask HR or payroll for any other pay code.";
  if (o.hours !== undefined && !(o.hours > 0)) return "Enter the hours worked, more than 0.";
  return null;
}

/**
 * Whether the caller may fix missed punches and make no other timecard change.
 * For an action that let them in through MISSED_PUNCH_FIXERS: anyone without
 * one of the editors' permissions came in on PUNCH_FIX_MISSED_TEAM.
 */
export async function fixesMissedPunchesOnly(): Promise<boolean> {
  for (const p of TIMECARD_EDITORS) if (await checkPermission(p)) return false;
  return true;
}

/** Throws unless these punches close a missed punch, or fill a day marked Absent, on the timecard. */
export async function assertMissedPunchFix(timesheetId: string, timeZone: string, added: AddedPunch[]): Promise<void> {
  const [existing, open, sheet, segments] = await Promise.all([
    db.punch.findMany({
      where: { timesheetId, isApproved: true, correctedById: null },
      select: { punchType: true, roundedTime: true },
    }),
    db.exception.findMany({
      where: { timesheetId, exceptionType: "MISSING_PUNCH", resolvedAt: null },
      select: { occurredAt: true },
    }),
    db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      select: {
        payPeriod: { select: { startDate: true, endDate: true } },
        employee: { select: { hireDate: true, adjustedHireDate: true, terminatedAt: true } },
      },
    }),
    db.workSegment.findMany({ where: { timesheetId }, select: { segmentDate: true } }),
  ]);
  // Marked at noon UTC on the day (segment-builder), so its day reads the same anywhere.
  const missedDays = new Set(open.map((e) => dayAt(e.occurredAt, timeZone)));
  const absent = {
    today: dayAt(new Date(), timeZone),
    periodStart: sheet.payPeriod.startDate.toISOString().slice(0, 10),
    periodEnd: sheet.payPeriod.endDate.toISOString().slice(0, 10),
    startedOn: startedOn(sheet.employee),
    endedOn: endedOn(sheet.employee),
    punchDays: new Set(existing.map((p) => dayAt(p.roundedTime, timeZone))),
    // A segment's date is the person's own day, stored at midnight UTC.
    segmentDays: new Set(segments.map((s) => s.segmentDate.toISOString().slice(0, 10))),
  };
  const absentDays = new Set(added.map((p) => dayAt(p.at, timeZone)).filter((d) => isAbsentDay(d, absent)));
  const refusal = missedPunchRefusal(added, existing, missedDays, timeZone, absentDays);
  if (refusal) throw new Error(refusal);
}
