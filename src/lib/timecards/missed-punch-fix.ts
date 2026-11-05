import { db } from "@/lib/db";
import { checkPermission } from "@/lib/rbac/check-permission";
import { TIMECARD_EDITORS } from "@/lib/rbac/permissions";
import { dayAt } from "@/lib/timecards/change-note";

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
 */

export const MISSED_PUNCH_ONLY_ERROR =
  "You can only add the missing clock in or clock out on a day marked Missed punch. Ask HR or payroll for any other change to this timecard.";

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
 * days ("yyyy-MM-dd" at the person's time zone) with an open missed punch.
 */
export function missedPunchRefusal(
  added: AddedPunch[],
  existing: TimecardPunch[],
  missedDays: Set<string>,
  timeZone: string,
): string | null {
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

/**
 * Whether the caller may fix missed punches and make no other timecard change.
 * For an action that let them in through MISSED_PUNCH_FIXERS: anyone without
 * one of the editors' permissions came in on PUNCH_FIX_MISSED_TEAM.
 */
export async function fixesMissedPunchesOnly(): Promise<boolean> {
  for (const p of TIMECARD_EDITORS) if (await checkPermission(p)) return false;
  return true;
}

/** Throws unless these punches each close a missed punch on the timecard. */
export async function assertMissedPunchFix(timesheetId: string, timeZone: string, added: AddedPunch[]): Promise<void> {
  const [existing, open] = await Promise.all([
    db.punch.findMany({
      where: { timesheetId, isApproved: true, correctedById: null },
      select: { punchType: true, roundedTime: true },
    }),
    db.exception.findMany({
      where: { timesheetId, exceptionType: "MISSING_PUNCH", resolvedAt: null },
      select: { occurredAt: true },
    }),
  ]);
  // Marked at noon UTC on the day (segment-builder), so its day reads the same anywhere.
  const missedDays = new Set(open.map((e) => dayAt(e.occurredAt, timeZone)));
  const refusal = missedPunchRefusal(added, existing, missedDays, timeZone);
  if (refusal) throw new Error(refusal);
}
