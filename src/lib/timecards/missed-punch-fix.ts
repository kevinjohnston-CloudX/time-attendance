import { db } from "@/lib/db";
import { checkPermission } from "@/lib/rbac/check-permission";
import { TIMECARD_EDITORS } from "@/lib/rbac/permissions";
import { dayAt } from "@/lib/timecards/change-note";
import { endedOn, startedOn } from "@/lib/engines/segment-builder";
import { personTimeZone } from "@/lib/utils/person-time-zone";

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
 *
 * <p>11/10: only on a row of regular hours. A shift's pay code is kept on its
 * clock in (shift-clock-in), so a clock out is not added after a clock in HR
 * put on another code (overtime, leave, Salary). They may also waive the meal
 * deducted on a day of regular hours, today or before (mealWaiverRefusal),
 * but not a meal premium, and Add time went back to HR and payroll.
 */

export const MISSED_PUNCH_ONLY_ERROR =
  "You can only add the missing clock in or clock out on a day marked Missed punch, or one clock in and clock out on a day marked Absent. Ask HR or payroll for any other change to this timecard.";

export const NOT_REGULAR_ROW_ERROR =
  "You can fix a missed punch only on a row of regular hours. Ask HR or payroll to fix one on another pay code.";

export type AddedPunch = { punchType: "CLOCK_IN" | "CLOCK_OUT"; at: Date };
/** `payCodeId` on a clock in is its shift's pay code. */
export type TimecardPunch = { punchType: string; roundedTime: Date; payCodeId?: string | null };

/** A code that is regular hours: none, or the rule set's own. */
export function isRegularCode(payCodeId: string | null | undefined, regularCodeId: string | null): boolean {
  return !payCodeId || payCodeId === regularCodeId;
}

function shiftDay(day: string, by: number): string {
  const d = new Date(day + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/**
 * Why these punches are not a missed punch fix, or null when each closes one.
 * `existing` is the timecard's approved, uncorrected punches; `missedDays` the
 * days ("yyyy-MM-dd" at the person's time zone) with an open missed punch;
 * `absentDays` the days marked Absent; `regularCodeId` the rule set's regular
 * hours code.
 */
export function missedPunchRefusal(
  added: AddedPunch[],
  existing: TimecardPunch[],
  missedDays: Set<string>,
  timeZone: string,
  absentDays: Set<string> = new Set(),
  regularCodeId: string | null = null,
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
      // The shift it closes is regular hours: its clock in carries the code.
      const start = punches.filter((e) => (e.punchType === "CLOCK_IN" || e.punchType === "CLOCK_OUT") && e.roundedTime.getTime() < t).at(-1);
      if (start?.punchType === "CLOCK_IN" && !isRegularCode(start.payCodeId, regularCodeId)) return NOT_REGULAR_ROW_ERROR;
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
 * A meal waiver, or taking one back, by a supervisor allowed only to fix
 * missed punches (11/10): on today or a day before it, and on a day of regular
 * hours, not one with a shift or a code on another pay code (`otherCodeDays`).
 * A meal premium waiver stays with HR and payroll. Days are "yyyy-MM-dd" at
 * the person's time zone.
 */
export function mealWaiverRefusal(o: { day: string; today: string; otherCodeDays: Set<string> }): string | null {
  if (o.day > o.today) return "You can't waive a meal on a future date. Waive it on the day, or after.";
  if (o.otherCodeDays.has(o.day)) return "You can waive a meal only on a day of regular hours. Ask HR or payroll for a day on another pay code.";
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
      select: { punchType: true, roundedTime: true, payCodeId: true },
    }),
    db.exception.findMany({
      where: { timesheetId, exceptionType: "MISSING_PUNCH", resolvedAt: null },
      select: { occurredAt: true },
    }),
    db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      select: {
        payPeriod: { select: { startDate: true, endDate: true } },
        employee: { select: { hireDate: true, adjustedHireDate: true, terminatedAt: true, ruleSet: { select: { defaultPayCodeId: true } } } },
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
  const refusal = missedPunchRefusal(added, existing, missedDays, timeZone, absentDays, sheet.employee.ruleSet.defaultPayCodeId ?? null);
  if (refusal) throw new Error(refusal);
}

/** Throws unless the meal on this day ("yyyy-MM-dd") may be waived, or the waiver taken back, by a missed punch fixer. */
export async function assertMealWaiverDay(timesheetId: string, day: string): Promise<void> {
  const [clockIns, sheet, markers] = await Promise.all([
    db.punch.findMany({
      where: { timesheetId, isApproved: true, correctedById: null, punchType: "CLOCK_IN", payCodeId: { not: null } },
      select: { roundedTime: true, payCodeId: true },
    }),
    db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      select: { employee: { select: { timeZone: true, site: { select: { timezone: true } }, ruleSet: { select: { defaultPayCodeId: true } } } } },
    }),
    // A pay code put on a day with no hours.
    db.workSegment.findMany({
      where: { timesheetId, segmentType: "LEAVE", durationMinutes: 0, payCodeId: { not: null } },
      select: { segmentDate: true, payCodeId: true },
    }),
  ]);
  const regularCodeId = sheet.employee.ruleSet.defaultPayCodeId ?? null;
  const timeZone = personTimeZone(sheet.employee, "UTC");
  const otherCodeDays = new Set([
    ...clockIns.filter((p) => !isRegularCode(p.payCodeId, regularCodeId)).map((p) => dayAt(p.roundedTime, timeZone)),
    // A segment's date is the person's own day, stored at midnight UTC.
    ...markers.filter((m) => !isRegularCode(m.payCodeId, regularCodeId)).map((m) => m.segmentDate.toISOString().slice(0, 10)),
  ]);
  const refusal = mealWaiverRefusal({ day, today: dayAt(new Date(), timeZone), otherCodeDays });
  if (refusal) throw new Error(refusal);
}
