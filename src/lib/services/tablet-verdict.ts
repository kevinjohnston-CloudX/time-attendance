/**
 * The two words a tablet understands, and the one place the timecard
 * pipeline's richer vocabulary is translated into them.
 *
 * A tablet records that a badge went IN or went OUT. The punch pipeline speaks
 * payroll — CLOCK_IN, CLOCK_OUT, MEAL_START, MEAL_END, BREAK_START, BREAK_END,
 * and the state WORK / OUT / MEAL / BREAK it leaves an employee in — because
 * timecards need that. Nothing on a tablet does: there is no meal button, no
 * break screen, and the person leaving for the day sees the same OUT whether
 * the pipeline filed it as a clock-out or a meal.
 *
 * Until 2026-09-24 the pipeline's words were copied straight onto the tablets'
 * transaction log (`scan_events.timecardPunchType` / `timecardStateAfter`) and
 * into the response the tablet reads. So when a rule set's `autoDeductMeal`
 * flipped on 2026-09-23, 129 exits at NJ3 and NJ299 were logged as MEAL_START
 * leaving MEAL, and Live Attendance showed a warehouse "on meal" that had gone
 * home — a payroll setting changing what the tablets' own record said.
 *
 * This module is the boundary. Everything the pipeline concludes is reduced to
 * the direction the badge took before it reaches a tablet or the tablets' log.
 * `detectPunchType`, `punches` and the timecard itself are not touched: payroll
 * still sees the meal.
 */
export type TabletVerdict = {
  /** The only two punch types a tablet knows; null when the input said nothing. */
  punchType: "CLOCK_IN" | "CLOCK_OUT" | null;
  /** On the clock (WORK) or not (OUT); null when the input said nothing. */
  stateAfter: "WORK" | "OUT" | null;
  direction: "IN" | "OUT" | null;
};

/** Punch types that put a badge IN — the transition ends with the employee working. */
const IN_TYPES = new Set(["CLOCK_IN", "MEAL_END", "BREAK_END"]);
/** Punch types that take a badge OUT — the transition ends with the employee away. */
const OUT_TYPES = new Set(["CLOCK_OUT", "MEAL_START", "BREAK_START"]);

/**
 * Reduces a pipeline result to what a tablet may be told.
 *
 * The state the pipeline left the employee in is the authority when present:
 * WORK is on the clock, and OUT, MEAL and BREAK all mean the badge went out.
 * That matches how detect-scan-discrepancies has always read the column. A
 * refused punch has no state, so the type it would have been decides instead.
 * Anything unrecognised comes back null rather than guessed — a server that
 * starts sending a new value must never be able to label a scan the wrong way
 * round, and the caller keeps the raw words for the record.
 */
export function toTabletVerdict(result: {
  punchType?: string | null;
  stateAfter?: string | null;
}): TabletVerdict {
  const direction = directionOf(result);
  if (direction === "IN") return { punchType: "CLOCK_IN", stateAfter: "WORK", direction };
  if (direction === "OUT") return { punchType: "CLOCK_OUT", stateAfter: "OUT", direction };
  return { punchType: null, stateAfter: null, direction: null };
}

function directionOf({
  punchType,
  stateAfter,
}: {
  punchType?: string | null;
  stateAfter?: string | null;
}): "IN" | "OUT" | null {
  const state = stateAfter?.trim().toUpperCase();
  if (state) return state === "WORK" ? "IN" : "OUT";
  const type = punchType?.trim().toUpperCase();
  if (type && IN_TYPES.has(type)) return "IN";
  if (type && OUT_TYPES.has(type)) return "OUT";
  return null;
}
