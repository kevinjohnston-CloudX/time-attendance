/**
 * What a supervisor may send HR for approval, and how each change reads
 * (11/11).
 *
 * <p>Where a site lets supervisors edit timecards, they make the changes HR
 * makes, on rows of regular hours only: add, change and remove punches, Add
 * time as regular hours, and waive a meal. Every one waits for HR (the
 * TimecardEditRequest model); none sets a pay code or a reason code, touches
 * leave or a meal premium, or reaches a row on another pay code (overtime,
 * leave, a code HR put on a day). Nothing goes on a future date.
 *
 * <p>A row's pay code is kept on the clock in that started its shift
 * (shift-clock-in), so a punch is on a regular row when that clock in has no
 * code or the rule set's regular hours code. A punch with no clock in before
 * it (a missed clock in) is on no row yet, and fixing it is regular hours.
 *
 * <p>No database here: the timecard screen asks the same questions the
 * server does (supervisor-edits.ts).
 */

export type RowPunch = { id: string; punchType: string; roundedTime: Date; payCodeId: string | null };

export const REGULAR_HOURS_ONLY_ERROR =
  "You can change only rows of regular hours. Ask HR or payroll to change a row on another pay code, a pay code or a reason code.";
export const FUTURE_DAY_ERROR = "You can't put a punch on a future date. Add it on the day, or after.";
export const SUPERVISOR_EDITS_OFF_ERROR = "Supervisors can't edit timecards at this person's site. Ask HR or payroll for this change.";
export const SALARIED_ERROR = "A salaried person's timecard is changed by HR or payroll. Ask them for this change.";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHIFT_MAX_MS = 16 * 60 * 60 * 1000;

/** A code that is regular hours: none, or the rule set's own. */
export function isRegularCode(payCodeId: string | null | undefined, regularCodeId: string | null): boolean {
  return !payCodeId || payCodeId === regularCodeId;
}

/**
 * The clock in that started the shift a moment falls in: the last clock in or
 * clock out at or before it, when that is a clock in, within 24 hours.
 */
export function shiftStartAt(at: Date, punches: RowPunch[]): RowPunch | null {
  const t = at.getTime();
  let last: RowPunch | null = null;
  for (const p of punches) {
    if (p.punchType !== "CLOCK_IN" && p.punchType !== "CLOCK_OUT") continue;
    const pt = p.roundedTime.getTime();
    if (pt > t) continue;
    if (!last || pt >= last.roundedTime.getTime()) last = p;
  }
  if (!last || last.punchType !== "CLOCK_IN" || t - last.roundedTime.getTime() > DAY_MS) return null;
  return last;
}

/** Whether a moment falls on a regular hours row, or on no row at all. */
export function landsOnRegularRow(at: Date, punches: RowPunch[], regularCodeId: string | null): boolean {
  const start = shiftStartAt(at, punches);
  return !start || isRegularCode(start.payCodeId, regularCodeId);
}

/** Whether a punch already on the timecard is on a regular hours row. */
export function onRegularRow(punch: RowPunch, punches: RowPunch[], regularCodeId: string | null): boolean {
  if (punch.punchType === "CLOCK_IN") return isRegularCode(punch.payCodeId, regularCodeId);
  return landsOnRegularRow(punch.roundedTime, punches.filter((p) => p.id !== punch.id), regularCodeId);
}

/**
 * Why a supervisor may not add, change or remove these punches, or null.
 * `days` are the "yyyy-MM-dd" days, at the person's time zone, the punches
 * land on; `codedDays` the days HR put a pay code on with no hours (a day
 * marked Absent given Call Out, say), which are that code's row.
 */
export function punchChangeRefusal(o: {
  /** The punch changed or removed, if any. */
  punch?: RowPunch;
  /** Where punches go: added ones, or the changed one's new time. */
  landing: Date[];
  punches: RowPunch[];
  regularCodeId: string | null;
  days: string[];
  today: string;
  codedDays: Set<string>;
}): string | null {
  if (o.punch && !onRegularRow(o.punch, o.punches, o.regularCodeId)) return REGULAR_HOURS_ONLY_ERROR;
  if (o.days.some((d) => d > o.today)) return FUTURE_DAY_ERROR;
  if (o.days.some((d) => o.codedDays.has(d))) return REGULAR_HOURS_ONLY_ERROR;
  const others = o.punch ? o.punches.filter((p) => p.id !== o.punch!.id) : o.punches;
  if (o.landing.some((at) => !landsOnRegularRow(at, others, o.regularCodeId))) return REGULAR_HOURS_ONLY_ERROR;
  return null;
}

/**
 * Add time by a supervisor: regular hours, a clock in and out or a number of
 * hours, on today or a day before it, on an open timecard, and not on a day HR
 * put another code on.
 */
export function addTimeRefusal(o: {
  status: string;
  day: string;
  today: string;
  codedDays: Set<string>;
  /** A clock in and out, when it is one. */
  pair?: { at: Date; endAt: Date };
  /** A number of hours, when it is one. */
  minutes?: number;
}): string | null {
  if (o.status !== "OPEN") return "You can add time only to an open timecard. Ask HR or payroll for this one.";
  if (o.day > o.today) return "You can't add time for a future date. Add it on the day, or after.";
  if (o.codedDays.has(o.day)) return REGULAR_HOURS_ONLY_ERROR;
  if (o.pair) {
    if (o.pair.endAt <= o.pair.at) return "The out time must be after the in time.";
    if (o.pair.endAt.getTime() - o.pair.at.getTime() > SHIFT_MAX_MS) return "A shift can be up to 16 hours. Check the AM and PM.";
  }
  if (o.minutes !== undefined && !(o.minutes > 0 && o.minutes <= 24 * 60)) return "Enter the hours worked, more than 0 and up to 24.";
  return null;
}

/**
 * A meal waiver, or taking one back: today or before, on a day of regular
 * hours, not one with a shift or a code on another pay code. A meal premium
 * waiver stays with HR and payroll.
 */
export function mealWaiverRefusal(o: { day: string; today: string; otherCodeDays: Set<string> }): string | null {
  if (o.day > o.today) return "You can't waive a meal on a future date. Waive it on the day, or after.";
  if (o.otherCodeDays.has(o.day)) return "You can waive a meal only on a day of regular hours. Ask HR or payroll for a day on another pay code.";
  return null;
}

/**
 * The changes HR is looking at, as they stood when the page loaded: each
 * waiting change and when it last changed. HR's decision carries it, and is
 * refused if a supervisor put a change right, or took one back, meanwhile
 * (John, 11/11): HR would otherwise approve a time they never saw.
 */
export function editsSeen(items: { id: string; updatedAt: string }[]): string {
  return items.map((i) => `${i.id}@${i.updatedAt}`).sort().join(",");
}

export const EDITS_CHANGED_ERROR =
  "The supervisor changed these after you opened them. Reload the page to see the changes, then decide.";

// ─── The changes themselves ──────────────────────────────────────────────────

/** A change as the timecard sends it. Times are ISO moments; days "yyyy-MM-dd". */
export type EditItemInput =
  | { kind: "ADD_PUNCH"; punchType: "CLOCK_IN" | "CLOCK_OUT"; at: string }
  | { kind: "CHANGE_PUNCH"; punchId: string; at: string }
  | { kind: "REMOVE_PUNCH"; punchId: string }
  | { kind: "ADD_PAIR"; day: string; at: string; endAt: string }
  | { kind: "ADD_HOURS"; day: string; minutes: number }
  | { kind: "MEAL_WAIVER"; day: string; waive: boolean };

export type EditKind = EditItemInput["kind"] | "APPROVE_REQUEST";

/** A change as it is kept, enough to say what it does. */
export type EditItemView = {
  kind: EditKind;
  punchType?: string | null;
  at?: Date | string | null;
  endAt?: Date | string | null;
  before?: Date | string | null;
  minutes?: number | null;
  waive?: boolean | null;
};

const PUNCH_WORD: Record<string, string> = { CLOCK_IN: "clock in", CLOCK_OUT: "clock out", MEAL_START: "meal start", MEAL_END: "meal end", BREAK_START: "break start", BREAK_END: "break end" };

function clock(at: Date | string | null | undefined, timeZone: string): string {
  if (!at) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(at));
}

/** The change in words, as HR reads it: "Change clock in 7:31 AM to 7:30 AM". */
export function describeEditItem(item: EditItemView, timeZone: string): string {
  const word = PUNCH_WORD[item.punchType ?? ""] ?? "punch";
  switch (item.kind) {
    case "ADD_PUNCH":
      return `Add ${word} ${clock(item.at, timeZone)}`;
    case "CHANGE_PUNCH":
      return `Change ${word} ${clock(item.before, timeZone)} to ${clock(item.at, timeZone)}`;
    case "REMOVE_PUNCH":
      return `Remove ${word} ${clock(item.before, timeZone)}`;
    case "ADD_PAIR":
      return `Add time ${clock(item.at, timeZone)} to ${clock(item.endAt, timeZone)}`;
    case "ADD_HOURS":
      return `Add ${((item.minutes ?? 0) / 60).toFixed(2)} hours`;
    case "MEAL_WAIVER":
      return item.waive ? "Waive the meal" : "Take back the meal waiver";
    case "APPROVE_REQUEST":
      return `Approve the employee's request: ${word} ${clock(item.at, timeZone)}`;
  }
}
