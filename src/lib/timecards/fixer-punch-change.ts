/**
 * Which saved punches a supervisor who fixes missed punches may change or
 * remove (PUNCH_FIX_MISSED_TEAM, 11/11).
 *
 * <p>Adding the one punch a shift is missing was not enough: a missed lunch
 * clock out turns every punch after it around (Heliana Salazar 11/10: in 8:03,
 * out 3:11, in 5:16, Missing, for in 8:03, out 2:11, in 3:11, out 5:16), and a
 * time they typed wrong on an Absent day could not be put right. So on a row of
 * regular hours they may now:
 * - change the time of any punch on a shift whose day is marked Missed punch;
 * - change or remove a punch they entered themselves (typed in, or their
 *   correction of one; source MANUAL, approved by them).
 * The new time stays on the shift's day, or the next for a late shift, today
 * or before, on a row of regular hours. A reason is asked for, as for HR.
 *
 * <p>No database here: the timecard screen asks the same question the server
 * does (missed-punch-fix assertFixerMayChangePunch).
 */

export type ChangePunch = {
  id: string;
  punchType: string;
  roundedTime: Date;
  /** On a clock in, its shift's pay code. */
  payCodeId?: string | null;
  /** Entered by the person asking: source MANUAL, approved by them. */
  mine?: boolean;
};

export const PUNCH_CHANGE_ERROR =
  "You can change a punch only on a day marked Missed punch, or one you entered yourself. Ask HR or payroll for any other change.";
export const PUNCH_REMOVE_ERROR = "You can remove only a punch you entered yourself. Ask HR or payroll to remove any other.";
export const PUNCH_CHANGE_ROW_ERROR = "You can change punches only on a row of regular hours. Ask HR or payroll for a row on another pay code.";

/** A code that is regular hours: none, or the rule set's own. */
export function isRegularCode(payCodeId: string | null | undefined, regularCodeId: string | null): boolean {
  return !payCodeId || payCodeId === regularCodeId;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The clock in a moment's shift began with: the last clock in or out at or before it, if a clock in, within a day. */
function shiftStart(at: Date, punches: ChangePunch[]): ChangePunch | null {
  let last: ChangePunch | null = null;
  for (const p of punches) {
    if (p.punchType !== "CLOCK_IN" && p.punchType !== "CLOCK_OUT") continue;
    if (p.roundedTime.getTime() > at.getTime()) continue;
    if (!last || p.roundedTime.getTime() >= last.roundedTime.getTime()) last = p;
  }
  if (!last || last.punchType !== "CLOCK_IN" || at.getTime() - last.roundedTime.getTime() > DAY_MS) return null;
  return last;
}

function nextDay(day: string): string {
  const d = new Date(day + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Why this supervisor may not change the punch to `newTime` (or remove it,
 * when null), or null when they may. `punches` is the timecard's approved,
 * uncorrected punches; `missedDays` the days marked Missed punch and `today`
 * the person's today ("yyyy-MM-dd"), and `dayOf` a moment's day on their clock.
 */
export function fixerPunchChangeRefusal(o: {
  punch: ChangePunch;
  newTime: Date | null;
  punches: ChangePunch[];
  regularCodeId: string | null;
  missedDays: Set<string>;
  today: string;
  dayOf: (at: Date) => string;
}): string | null {
  const others = o.punches.filter((p) => p.id !== o.punch.id);
  const start = o.punch.punchType === "CLOCK_IN" ? o.punch : shiftStart(o.punch.roundedTime, others);
  if (start && !isRegularCode(start.payCodeId, o.regularCodeId)) return PUNCH_CHANGE_ROW_ERROR;
  if (o.newTime === null) return o.punch.mine ? null : PUNCH_REMOVE_ERROR;

  const shiftDay = o.dayOf((start ?? o.punch).roundedTime);
  if (!o.punch.mine && !o.missedDays.has(shiftDay)) return PUNCH_CHANGE_ERROR;
  const lands = o.dayOf(o.newTime);
  if (lands > o.today) return "You can't put a punch on a future date. Change it on the day, or after.";
  if (lands !== shiftDay && lands !== nextDay(shiftDay)) return "Keep the time on the shift's day, or after midnight for a late shift.";
  if (o.punch.punchType !== "CLOCK_IN") {
    const landsIn = shiftStart(o.newTime, others);
    if (landsIn && !isRegularCode(landsIn.payCodeId, o.regularCodeId)) return PUNCH_CHANGE_ROW_ERROR;
  }
  return null;
}
