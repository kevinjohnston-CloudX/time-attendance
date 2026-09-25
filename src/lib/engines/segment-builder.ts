import { format, eachDayOfInterval, isWeekend, addDays } from "date-fns";
import { db } from "@/lib/db";
import { applyOvertime } from "@/lib/engines/overtime-engine";
import { reconcileLeaveDeductions } from "@/lib/engines/leave-deduction";
import { startOfDayInTz, nextMidnightInTz, endOfDayInTz, roundDurationMinutes } from "@/lib/utils/date";
import type { Punch, RuleSet, PayBucket, SegmentType, HolidayCreditMethod } from "@prisma/client";
import type { MealConfig } from "@/actions/shift.actions";

type MealPremiumRowCfg = {
  applyFromMinutes: number;    // window start relative to shift start (minutes)
  applyToMinutes: number;      // window end relative to shift start — shift must pass this for rule to trigger
  minimumMealMinutes: number;  // minimum qualifying meal duration
  payMinutes: number;          // premium credit minutes
  payCodeId: string | null;
  unlessHoursExceed: boolean;  // suppress if total worked > unlessHoursExceedMinutes
  unlessHoursExceedMinutes: number;
  unlessPunchedMeal: boolean;  // only real MEAL_START/MEAL_END punches suppress premium (vs. any MEAL segment)
};

type EffectiveMealCfg = {
  mealBreakAfterMinutes: number;
  mealBreakMinutes: number;
  minMealMinutes: number;   // lower bound: punch gap shorter than this is not a meal
  maxMealMinutes: number;   // upper bound: punch gap longer than this is not a meal
  disableMinDeduction: boolean; // true = use actual gap; false = enforce mealBreakMinutes minimum
};

const SALARY_DAILY_MINUTES = 480; // 8 h

type ActiveState = "WORK" | "MEAL" | "BREAK";

interface SegmentInput {
  timesheetId: string;
  segmentType: SegmentType;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  segmentDate: Date;
  isPaid: boolean;
  payBucket: PayBucket;
  isSplit: boolean;
  payCodeId?: string | null;
}

/**
 * Determine isPaid from state and ruleSet.
 * MEAL breaks are unpaid; WORK and short BREAKs are paid.
 */
function isPaidSegment(state: ActiveState): boolean {
  return state !== "MEAL";
}

function payBucketFor(state: ActiveState): PayBucket {
  if (state === "MEAL") return "UNPAID";
  return "REG"; // OT engine (Phase 4) reclassifies REG → OT/DT
}

/**
 * Build one or more SegmentInputs from a time range, splitting at every local midnight.
 * Uses the employee's site timezone so splits happen at the correct wall-clock midnight,
 * not UTC midnight. Recursive — handles shifts crossing multiple midnights.
 */
function buildSegmentSpan(
  timesheetId: string,
  start: Date,
  end: Date,
  state: ActiveState,
  isSplit: boolean,
  timezone: string
): SegmentInput[] {
  const nextMidnight = nextMidnightInTz(start, timezone);

  if (end <= nextMidnight) {
    const durationMinutes = (end.getTime() - start.getTime()) / 60_000;
    if (durationMinutes <= 0) return [];
    return [
      {
        timesheetId,
        segmentType: state as SegmentType,
        startTime: start,
        endTime: end,
        durationMinutes,
        segmentDate: startOfDayInTz(start, timezone),
        isPaid: isPaidSegment(state),
        payBucket: payBucketFor(state),
        isSplit,
      },
    ];
  }

  // Crosses midnight — split and recurse
  return [
    ...buildSegmentSpan(timesheetId, start, nextMidnight, state, true, timezone),
    ...buildSegmentSpan(timesheetId, nextMidnight, end, state, true, timezone),
  ];
}

/**
 * Pure function: given an ordered list of approved punches,
 * returns the set of WorkSegment rows to insert.
 */
const truncToMin = (d: Date): Date => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

export function computeSegments(
  timesheetId: string,
  punches: Punch[],
  timezone: string,
  // Pay period start — used as the floor when recovering hours for an orphaned close punch.
  periodStart?: Date,
  // Active state carried in from the previous pay period (employee clocked in before this
  // period started and clocked out inside it). openStart is clamped to periodStart so only
  // hours earned in this period are credited.
  carryIn?: { openStart: Date; openState: ActiveState }
): SegmentInput[] {
  const segments: SegmentInput[] = [];
  let openStart: Date | null = carryIn ? truncToMin(carryIn.openStart) : null;
  let openState: ActiveState | null = carryIn?.openState ?? null;

  for (const punch of punches) {
    const punchMin = truncToMin(punch.roundedTime);

    // Orphan recovery: this punch expects to close an active segment (stateBefore !== OUT)
    // but nothing is open — the matching clock-in was in a previous pay period or is missing.
    // Use the start of the punch's local calendar day as the implicit open (floored to
    // periodStart so we never credit time before this period began).
    if (!openState && punch.stateBefore !== "OUT") {
      const dayStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(punchMin);
      const [y, m, d] = dayStr.split("-").map(Number);
      const dayStartUtc = new Date(Date.UTC(y, m - 1, d));
      const floor = periodStart && periodStart > dayStartUtc ? truncToMin(periodStart) : dayStartUtc;
      openStart = floor;
      openState = punch.stateBefore as ActiveState;
    }

    // Close the previous segment at this punch's truncated minute
    if (openState && openStart) {
      const openDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(openStart);
      const punchDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(punchMin);

      const dayDiff = (new Date(punchDay + "T00:00:00Z").getTime() - new Date(openDay + "T00:00:00Z").getTime()) / (24 * 60 * 60_000);
      if (openDay !== punchDay && (punch.stateBefore === "OUT" || dayDiff > 1)) {
        // Discard when the open segment crosses into a later day via a missing clock-out.
        // Two cases: (1) stateBefore="OUT" means the end-of-day SYSTEM reset fired, indicating
        // a missed clock-out on the previous day; (2) dayDiff > 1 means the CLOCK_IN was left
        // open across multiple days (e.g. employee left for the weekend), which produces phantom
        // 24-hour blocks. In both cases the MISSING_PUNCH exception still flags the day.
      } else {
        segments.push(
          ...buildSegmentSpan(timesheetId, openStart, punchMin, openState, false, timezone)
        );
      }
      openStart = null;
      openState = null;
    }

    // Open a new segment if entering an active state
    if (punch.stateAfter !== "OUT") {
      openStart = punchMin;
      openState = punch.stateAfter as ActiveState;
    }
  }

  // If the employee is still clocked in at the end of the punch list (same day),
  // leave no dangling segment — an in-progress shift is captured on the next punch.

  return segments;
}

/**
 * Validate real MEAL segments (from actual MEAL_START/MEAL_END punches) against
 * the shift's configured punch-gap range and minimum-deduction rules.
 *
 * - Gap outside [minMealMinutes, maxMealMinutes]: not a real meal → merge back into WORK
 * - Gap within range but shorter than mealBreakMinutes and !disableMinDeduction:
 *   inflate MEAL to mealBreakMinutes (minimum deduction enforced), shorten adjacent WORK
 * - Gap within range and (disableMinDeduction or gap >= mealBreakMinutes): keep as-is
 *
 * Must run before applyAutoMealDeduction so days that lose their real MEAL segment
 * here still get the synthetic auto-deduct applied.
 */
function applyMealPunchValidation(
  segments: SegmentInput[],
  cfg: EffectiveMealCfg
): SegmentInput[] {
  const { minMealMinutes, maxMealMinutes, mealBreakMinutes, disableMinDeduction } = cfg;
  const mealSegs = segments.filter(s => s.segmentType === "MEAL");
  if (mealSegs.length === 0) return segments;

  const toRemove = new Set<SegmentInput>();
  const toAdd: SegmentInput[] = [];

  for (const meal of mealSegs) {
    const gapMins = meal.durationMinutes;

    const before = segments.find(
      s => s.segmentType === "WORK" && s.endTime.getTime() === meal.startTime.getTime()
    );
    const after = segments.find(
      s => s.segmentType === "WORK" && s.startTime.getTime() === meal.endTime.getTime()
    );

    if (gapMins < minMealMinutes || gapMins > maxMealMinutes) {
      // Invalid gap — this isn't a meal, fold back into WORK
      toRemove.add(meal);
      if (before && after) {
        toRemove.add(before);
        toRemove.add(after);
        toAdd.push({
          ...before,
          endTime: after.endTime,
          durationMinutes: before.durationMinutes + gapMins + after.durationMinutes,
        });
      } else if (before) {
        toRemove.add(before);
        toAdd.push({ ...before, endTime: meal.endTime, durationMinutes: before.durationMinutes + gapMins });
      } else if (after) {
        toRemove.add(after);
        toAdd.push({ ...after, startTime: meal.startTime, durationMinutes: after.durationMinutes + gapMins });
      }
    } else if (!disableMinDeduction && gapMins < mealBreakMinutes) {
      // Valid meal but shorter than the required minimum — inflate to minimum,
      // trimming the same amount from the after-WORK segment.
      const extraMins = mealBreakMinutes - gapMins;
      const newMealEnd = new Date(meal.endTime.getTime() + extraMins * 60_000);

      toRemove.add(meal);
      toAdd.push({ ...meal, endTime: newMealEnd, durationMinutes: mealBreakMinutes });

      if (after) {
        toRemove.add(after);
        const newAfterMins = after.durationMinutes - extraMins;
        if (newAfterMins > 0) {
          toAdd.push({ ...after, startTime: newMealEnd, durationMinutes: newAfterMins });
        }
      }
    }
    // else: valid gap, disableMinDeduction true or gap >= minimum → keep as-is
  }

  return [...segments.filter(s => !toRemove.has(s)), ...toAdd];
}

/**
 * For NJ-style auto-deduct employees: after computing segments from punches,
 * inject a synthetic MEAL segment on any day where the employee worked more
 * than ruleSet.mealBreakAfterMinutes, unless that day is in waivedDates.
 *
 * The MEAL is inserted at the mealBreakAfterMinutes mark from the first
 * WORK segment's start time, splitting that segment in two.
 */
function applyAutoMealDeduction(
  segments: SegmentInput[],
  cfg: EffectiveMealCfg,
  waivedDates: Set<string>
): SegmentInput[] {
  // Group WORK segments by calendar day (yyyy-MM-dd)
  const byDay = new Map<string, SegmentInput[]>();
  for (const seg of segments) {
    if (seg.segmentType !== "WORK") continue;
    const key = format(seg.segmentDate, "yyyy-MM-dd");
    const list = byDay.get(key) ?? [];
    list.push(seg);
    byDay.set(key, list);
  }

  const extra: SegmentInput[] = [];
  const toRemove = new Set<SegmentInput>();
  const toAdd: SegmentInput[] = [];

  for (const [dayKey, workSegs] of byDay) {
    if (waivedDates.has(dayKey)) continue;

    // If the employee already punched a real meal, no synthetic deduction needed
    const hasRealMeal = segments.some(
      (s) =>
        s.segmentType === "MEAL" &&
        format(s.segmentDate, "yyyy-MM-dd") === dayKey
    );
    if (hasRealMeal) continue;

    const totalWork = workSegs.reduce((s, seg) => s + seg.durationMinutes, 0);
    if (totalWork <= cfg.mealBreakAfterMinutes) continue;

    // Sort by start time
    const sorted = [...workSegs].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    // Find the segment that contains the meal start point
    let mealStartMs =
      sorted[0].startTime.getTime() + cfg.mealBreakAfterMinutes * 60_000;
    let mealEndMs = mealStartMs + cfg.mealBreakMinutes * 60_000;

    const target = sorted.find(
      (seg) =>
        seg.startTime.getTime() <= mealStartMs &&
        seg.endTime.getTime() > mealStartMs
    );
    if (!target) continue; // Meal point falls in a gap — skip deduction

    // If the meal window extends past the target segment's end (employee clocked out
    // before the meal finished), slide the meal back so it ends at clock-out.
    // This implements a true HOURS_WORKED deduction: paid = total pair - meal minutes.
    if (mealEndMs > target.endTime.getTime()) {
      mealEndMs = target.endTime.getTime();
      mealStartMs = mealEndMs - cfg.mealBreakMinutes * 60_000;
      // If even the adjusted meal start is before the segment start, skip
      if (mealStartMs < target.startTime.getTime()) continue;
    }

    toRemove.add(target);

    const mealStart = new Date(mealStartMs);
    const mealEnd = new Date(mealEndMs);
    const segmentDate = target.segmentDate;

    // Before-meal WORK piece
    const beforeMins = Math.round((mealStartMs - target.startTime.getTime()) / 60_000);
    if (beforeMins > 0) {
      toAdd.push({
        timesheetId: target.timesheetId,
        segmentType: "WORK",
        startTime: target.startTime,
        endTime: mealStart,
        durationMinutes: beforeMins,
        segmentDate,
        isPaid: true,
        payBucket: "REG",
        isSplit: target.isSplit,
      });
    }

    // Synthetic MEAL segment
    const mealMins = cfg.mealBreakMinutes;
    extra.push({
      timesheetId: target.timesheetId,
      segmentType: "MEAL",
      startTime: mealStart,
      endTime: mealEnd,
      durationMinutes: mealMins,
      segmentDate,
      isPaid: false,
      payBucket: "UNPAID",
      isSplit: false,
    });

    // After-meal WORK piece (target segment may extend past meal end)
    const afterStartMs = Math.max(mealEndMs, target.startTime.getTime());
    const afterMins = Math.round((target.endTime.getTime() - afterStartMs) / 60_000);
    if (afterMins > 0) {
      toAdd.push({
        timesheetId: target.timesheetId,
        segmentType: "WORK",
        startTime: new Date(afterStartMs),
        endTime: target.endTime,
        durationMinutes: afterMins,
        segmentDate,
        isPaid: true,
        payBucket: "REG",
        isSplit: target.isSplit,
      });
    }
  }

  return [
    ...segments
      .filter((s) => !toRemove.has(s))
      .map((s) => {
        // On a waived day, convert any real MEAL segment to paid WORK time
        if (
          s.segmentType === "MEAL" &&
          waivedDates.has(format(s.segmentDate, "yyyy-MM-dd"))
        ) {
          return { ...s, segmentType: "WORK" as SegmentType, isPaid: true, payBucket: "REG" as PayBucket };
        }
        return s;
      }),
    ...toAdd,
    ...extra,
  ];
}

/**
 * In/Out Pair rounding: rounds the total WORK duration per calendar day after meal
 * deductions have already been applied.  Also enforces a per-day minimum guarantee.
 *
 * The difference between the rounded and raw totals is absorbed by the last WORK
 * segment of the day so start/end timestamps remain meaningful while durationMinutes
 * reflects the credited (rounded) time.
 */
function applyPairRounding(segments: SegmentInput[], ruleSet: RuleSet): SegmentInput[] {
  if (!ruleSet.pairRoundingEnabled) return segments;

  const interval = ruleSet.pairRoundingMinutes;
  const point    = ruleSet.pairRoundingPoint;
  const minGuaranteed = ruleSet.pairMinGuaranteedMinutes;

  // Group WORK segments by calendar day key
  const byDay = new Map<string, SegmentInput[]>();
  for (const seg of segments) {
    if (seg.segmentType !== "WORK") continue;
    const key = format(seg.segmentDate, "yyyy-MM-dd");
    const list = byDay.get(key) ?? [];
    list.push(seg);
    byDay.set(key, list);
  }

  const result = [...segments];

  for (const workSegs of byDay.values()) {
    const rawTotal = workSegs.reduce((sum, s) => sum + s.durationMinutes, 0);
    let credited = roundDurationMinutes(rawTotal, interval, point);
    if (minGuaranteed > 0) credited = Math.max(credited, minGuaranteed);

    const diff = credited - rawTotal;
    if (diff === 0) continue;

    // Apply the adjustment to the last WORK segment of the day
    const lastSeg = [...workSegs].sort((a, b) => b.endTime.getTime() - a.endTime.getTime())[0];
    const idx = result.indexOf(lastSeg);
    if (idx >= 0) {
      result[idx] = { ...lastSeg, durationMinutes: Math.max(0, lastSeg.durationMinutes + diff) };
    }
  }

  return result;
}

/**
 * Guaranteed Hours / Auto-Pay: inserts a configurable daily credit for every
 * eligible day in the pay period (up to and including today) that has no
 * existing WORK segment. Called inside rebuildSegments before applyOvertime
 * so auto-pay credits are included in the OT accumulator.
 */
async function applyAutoPayCredits(
  timesheetId: string,
  periodStart: Date,
  periodEnd: Date,
  ruleSet: RuleSet,
  shift: { startTime: string; endTime: string; workDays: number[] } | null,
  creditsFrom?: Date,
): Promise<void> {
  const periodEndInclusive = addDays(periodEnd, -1);

  const allDays = eachDayOfInterval({ start: periodStart, end: periodEndInclusive });

  // Skip days already covered by real punch-derived WORK segments
  const existing = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "WORK" },
    select: { segmentDate: true },
  });
  const coveredDates = new Set(existing.map((s) => format(s.segmentDate, "yyyy-MM-dd")));

  // Build a map of leave minutes per day from approved leave segments
  const leaveSegs = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "LEAVE", leaveRequestId: { not: null } },
    select: { segmentDate: true, durationMinutes: true },
  });
  const leaveMinutesByDate = new Map<string, number>();
  for (const s of leaveSegs) {
    const k = format(s.segmentDate, "yyyy-MM-dd");
    leaveMinutesByDate.set(k, (leaveMinutesByDate.get(k) ?? 0) + s.durationMinutes);
  }

  const basePayCodeId = ruleSet.autoPayPayCodeId ?? ruleSet.defaultPayCodeId ?? null;
  const overflowPayCodeId = ruleSet.autoPayOverflowPayCodeId ?? null;
  const overflowThreshold = ruleSet.autoPayOverflowThresholdMinutes;

  let runningMinutes = 0;
  const toCreate: SegmentInput[] = [];

  if (ruleSet.autoPayMode === "SHIFT_HOURS" && shift) {
    // Derive credit amount from shift duration; eligible days from shift.workDays
    const [sh, sm] = shift.startTime.split(":").map(Number);
    const [eh, em] = shift.endTime.split(":").map(Number);
    let endMins = eh * 60 + em;
    const startMins = sh * 60 + sm;
    if (endMins <= startMins) endMins += 1440;
    const dailyMinutes = endMins - startMins;
    if (dailyMinutes <= 0) return;

    for (const d of allDays) {
      if (creditsFrom && format(d, "yyyy-MM-dd") < format(creditsFrom, "yyyy-MM-dd")) continue;
      if (!shift.workDays.includes(d.getUTCDay())) continue;
      if (coveredDates.has(format(d, "yyyy-MM-dd"))) continue;
      const dateKey = format(d, "yyyy-MM-dd");
      const leaveMinutes = leaveMinutesByDate.get(dateKey) ?? 0;
      const creditMinutes = dailyMinutes - leaveMinutes;
      if (creditMinutes <= 0) continue; // full-day leave — skip auto-credit
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const useOverflow = overflowThreshold > 0 && overflowPayCodeId !== null && runningMinutes >= overflowThreshold;
      runningMinutes += creditMinutes;
      toCreate.push({
        timesheetId,
        segmentType: "WORK" as SegmentType,
        startTime: start,
        endTime: new Date(start.getTime() + creditMinutes * 60_000),
        durationMinutes: creditMinutes,
        segmentDate: start,
        isPaid: true,
        payBucket: "REG" as PayBucket,
        isSplit: false,
        payCodeId: useOverflow ? overflowPayCodeId : basePayCodeId,
      });
    }
  } else {
    // POLICY_HOURS: per-day schedule drives both eligibility and credit amount
    type DayRow = { day: number; apply: boolean; minutes: number };
    const schedule = ruleSet.autoPayDaySchedule as DayRow[] | null;
    const dayMap = new Map<number, DayRow>((schedule ?? []).map((r) => [r.day, r]));

    for (const d of allDays) {
      if (creditsFrom && format(d, "yyyy-MM-dd") < format(creditsFrom, "yyyy-MM-dd")) continue;
      if (coveredDates.has(format(d, "yyyy-MM-dd"))) continue;
      const row = dayMap.get(d.getUTCDay());
      if (!row?.apply || !row.minutes) continue;
      const dateKey = format(d, "yyyy-MM-dd");
      const leaveMinutes = leaveMinutesByDate.get(dateKey) ?? 0;
      const creditMinutes = row.minutes - leaveMinutes;
      if (creditMinutes <= 0) continue; // full-day leave — skip auto-credit
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const useOverflow = overflowThreshold > 0 && overflowPayCodeId !== null && runningMinutes >= overflowThreshold;
      runningMinutes += creditMinutes;
      toCreate.push({
        timesheetId,
        segmentType: "WORK" as SegmentType,
        startTime: start,
        endTime: new Date(start.getTime() + creditMinutes * 60_000),
        durationMinutes: creditMinutes,
        segmentDate: start,
        isPaid: true,
        payBucket: "REG" as PayBucket,
        isSplit: false,
        payCodeId: useOverflow ? overflowPayCodeId : basePayCodeId,
      });
    }
  }

  if (toCreate.length === 0) return;
  await db.workSegment.createMany({ data: toCreate });
}

/**
 * Full rebuild: deletes all existing WorkSegments for a timesheet,
 * recomputes from approved punches, inserts new segments, then runs
 * the overtime engine to reclassify REG → OT / DT buckets.
 *
 * Call this after any punch change (create, approve, correct).
 */
/**
 * For salary employees: inserts an 8 h REG WorkSegment for every weekday in the
 * pay period (up to and including today) that has no existing WORK segment.
 * Called inside rebuildSegments so credits survive any punch-triggered rebuild.
 */
async function ensureSalarySegments(
  timesheetId: string,
  periodStart: Date,
  periodEnd: Date,
  defaultPayCodeId?: string | null,
  creditsFrom?: Date,
): Promise<void> {
  const periodEndInclusive = addDays(periodEnd, -1);

  const workDays = eachDayOfInterval({ start: periodStart, end: periodEndInclusive }).filter(
    (d) => !isWeekend(d)
  );
  if (workDays.length === 0) return;

  // Find dates that already have a WORK segment from real punches.
  const existing = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "WORK" },
    select: { segmentDate: true },
  });
  const coveredDates = new Set(
    existing.map((s) => format(s.segmentDate, "yyyy-MM-dd"))
  );

  // Build a map of leave minutes per day from approved leave segments
  const leaveSegs = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "LEAVE", leaveRequestId: { not: null } },
    select: { segmentDate: true, durationMinutes: true },
  });
  const leaveMinutesByDate = new Map<string, number>();
  for (const s of leaveSegs) {
    const k = format(s.segmentDate, "yyyy-MM-dd");
    leaveMinutesByDate.set(k, (leaveMinutesByDate.get(k) ?? 0) + s.durationMinutes);
  }

  const toCreate: SegmentInput[] = [];
  for (const d of workDays) {
    const dateKey = format(d, "yyyy-MM-dd");
    if (creditsFrom && dateKey < format(creditsFrom, "yyyy-MM-dd")) continue;
    if (coveredDates.has(dateKey)) continue;
    const leaveMinutes = leaveMinutesByDate.get(dateKey) ?? 0;
    const creditMinutes = SALARY_DAILY_MINUTES - leaveMinutes;
    if (creditMinutes <= 0) continue; // full-day leave — skip auto-credit
    const start = new Date(d);
    start.setUTCHours(0, 0, 0, 0);
    toCreate.push({
      timesheetId,
      segmentType: "WORK" as SegmentType,
      startTime: start,
      endTime: new Date(start.getTime() + creditMinutes * 60_000),
      durationMinutes: creditMinutes,
      segmentDate: start,
      isPaid: true,
      payBucket: "REG" as PayBucket,
      isSplit: false,
      payCodeId: defaultPayCodeId ?? null,
    });
  }

  if (toCreate.length > 0) {
    await db.workSegment.createMany({ data: toCreate });
  }
}

/**
 * Compute meal break premium segments for days where a qualifying meal was not taken.
 *
 * For each active MealPremiumRow, the rule triggers when:
 *  - The shift span (clock-in to clock-out) exceeds row.applyToMinutes
 *  - No qualifying meal occurred within [shiftStart + applyFromMinutes, shiftStart + applyToMinutes]
 *  - Optional suppressions (unlessHoursExceed, unlessPunchedMeal) do not apply
 *
 * Returns MEAL_PREMIUM SegmentInputs appended after the shift, one per triggered row per day.
 */
function computeMealPremiums(
  timesheetId: string,
  segments: SegmentInput[],
  punches: Punch[],
  ruleSet: RuleSet,
  timezone: string,
  premiumWaivedStarts: Set<string> = new Set(),
): SegmentInput[] {
  if (!ruleSet.mealBreakPremiumEnabled) return [];

  const rows = (ruleSet.mealPremiumRows as MealPremiumRowCfg[] | null) ?? [];
  const activeRows = rows.filter(r => r.payMinutes > 0 && r.payCodeId);
  if (activeRows.length === 0) return [];

  const premiums: SegmentInput[] = [];

  // Group work + meal segments by local calendar day
  const dayKeys = new Set(
    segments.filter(s => s.segmentType === "WORK").map(s => format(s.segmentDate, "yyyy-MM-dd"))
  );

  for (const dayKey of dayKeys) {
    const daySegs = segments.filter(s => format(s.segmentDate, "yyyy-MM-dd") === dayKey);
    const workSegs = daySegs.filter(s => s.segmentType === "WORK");
    const mealSegs = daySegs.filter(s => s.segmentType === "MEAL");

    if (workSegs.length === 0) continue;

    // Punches for this local calendar day (keyed by actual punchTime in site tz)
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    const dayPunches = punches.filter(p => fmt.format(p.punchTime) === dayKey);

    // Shift span and start — use actual punch times when configured, else rounded segment times
    let shiftStartMs: number;
    let shiftSpanMins: number;
    if (ruleSet.mealPremiumUseActualForWindow) {
      const clockIns = dayPunches.filter(p => p.punchType === "CLOCK_IN");
      const clockOuts = dayPunches.filter(p => p.punchType === "CLOCK_OUT");
      if (clockIns.length === 0 || clockOuts.length === 0) continue;
      shiftStartMs = clockIns[0].punchTime.getTime();
      const shiftEndMs = clockOuts[clockOuts.length - 1].punchTime.getTime();
      shiftSpanMins = (shiftEndMs - shiftStartMs) / 60_000;
    } else {
      const sorted = [...workSegs].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      shiftStartMs = sorted[0].startTime.getTime();
      const lastWork = sorted[sorted.length - 1];
      shiftSpanMins = (lastWork.endTime.getTime() - shiftStartMs) / 60_000
        + mealSegs.reduce((s, m) => s + m.durationMinutes, 0);
    }

    const totalWorkedMins = workSegs.reduce((s, w) => s + w.durationMinutes, 0);
    const realMealStarts = dayPunches.filter(p => p.punchType === "MEAL_START");
    const lastWorkSeg = workSegs.reduce((a, b) => a.endTime > b.endTime ? a : b);

    // Detect missing clock-out: last clock punch of the day is a CLOCK_IN with no CLOCK_OUT.
    // In this case we don't know the true shift end, so assume the shift extended past the
    // premium window and calculate a premium until the discrepancy is corrected.
    const sortedClockPunches = dayPunches
      .filter(p => p.punchType === "CLOCK_IN" || p.punchType === "CLOCK_OUT")
      .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
    const hasMissingClockOut = sortedClockPunches.length > 0 &&
      sortedClockPunches[sortedClockPunches.length - 1].punchType === "CLOCK_IN";

    let premiumsThisDay = 0;

    for (const row of activeRows) {
      if (premiumsThisDay >= ruleSet.mealBreakPremiumMaxPerDay) break;

      // Trigger: shift must extend past the end of the required meal window.
      // If the employee has a missing clock-out, the true shift end is unknown —
      // skip this check and award the premium until the discrepancy is corrected.
      if (!hasMissingClockOut && shiftSpanMins < row.applyToMinutes) continue;

      // unlessHoursExceed: suppress when total worked exceeds threshold
      if (row.unlessHoursExceed && totalWorkedMins > row.unlessHoursExceedMinutes) continue;

      // Window within which a qualifying meal must have occurred
      const windowStartMs = shiftStartMs + row.applyFromMinutes * 60_000;
      const windowEndMs = shiftStartMs + row.applyToMinutes * 60_000;

      let hasQualifyingMeal = false;

      if (row.unlessPunchedMeal) {
        // Only real MEAL_START/MEAL_END punch pairs count
        for (const ms of realMealStarts) {
          const msPunchMs = ruleSet.mealPremiumUseActualForWindow
            ? ms.punchTime.getTime()
            : ms.roundedTime.getTime();
          if (msPunchMs < windowStartMs || msPunchMs >= windowEndMs) continue;
          const me = dayPunches.find(p => p.punchType === "MEAL_END" && p.punchTime > ms.punchTime);
          if (!me) continue;
          const gapMins = ruleSet.mealPremiumUseActualForMinimum
            ? (me.punchTime.getTime() - ms.punchTime.getTime()) / 60_000
            : (mealSegs.find(s => Math.abs(s.startTime.getTime() - ms.roundedTime.getTime()) < 2 * 60_000)?.durationMinutes ?? 0);
          if (gapMins >= row.minimumMealMinutes) { hasQualifyingMeal = true; break; }
        }
      } else {
        // Any MEAL segment whose start falls within the window qualifies
        for (const mealSeg of mealSegs) {
          if (mealSeg.startTime.getTime() < windowStartMs || mealSeg.startTime.getTime() >= windowEndMs) continue;
          if (mealSeg.durationMinutes >= row.minimumMealMinutes) { hasQualifyingMeal = true; break; }
        }

        // Also treat gaps between consecutive CLOCK_IN/CLOCK_OUT pairs as a qualifying meal.
        // When no MEAL segments exist (e.g. autoDeductMeal:false with no MEAL_START punches),
        // the gap between two work sessions is the employee's actual clocked-out break.
        if (!hasQualifyingMeal) {
          const sortedOuts = dayPunches
            .filter(p => p.punchType === "CLOCK_OUT")
            .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
          for (const co of sortedOuts) {
            const gapStartMs = ruleSet.mealPremiumUseActualForWindow ? co.punchTime.getTime() : co.roundedTime.getTime();
            if (gapStartMs < windowStartMs || gapStartMs >= windowEndMs) continue;
            const nextCi = dayPunches
              .filter(p => p.punchType === "CLOCK_IN" && p.punchTime > co.punchTime)
              .sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime())[0];
            if (!nextCi) continue;
            const gapEndMs = ruleSet.mealPremiumUseActualForWindow ? nextCi.punchTime.getTime() : nextCi.roundedTime.getTime();
            const gapMins = (gapEndMs - gapStartMs) / 60_000;
            if (gapMins >= row.minimumMealMinutes) { hasQualifyingMeal = true; break; }
          }
        }
      }

      if (hasQualifyingMeal) continue;

      // Premium is owed
      let premiumMins = row.payMinutes;
      if (ruleSet.mealPremiumLimitToPayMinutes) {
        const totalMealMins = mealSegs.reduce((s, m) => s + m.durationMinutes, 0);
        premiumMins = Math.min(premiumMins, totalWorkedMins - totalMealMins);
      }
      if (premiumMins <= 0) continue;

      if (premiumWaivedStarts.has(lastWorkSeg.endTime.toISOString())) continue;
      premiums.push({
        timesheetId,
        segmentType: "MEAL_PREMIUM",
        startTime: lastWorkSeg.endTime,
        endTime: new Date(lastWorkSeg.endTime.getTime() + premiumMins * 60_000),
        durationMinutes: premiumMins,
        segmentDate: lastWorkSeg.segmentDate,
        isPaid: true,
        payBucket: "REG",
        payCodeId: row.payCodeId,
        isSplit: false,
      });

      premiumsThisDay++;
    }
  }

  return premiums;
}

export async function rebuildSegments(
  timesheetId: string,
  ruleSet: RuleSet
): Promise<void> {
  // Fetch the employee's site timezone so segment dates use the correct calendar day.
  const timesheet = await db.timesheet.findUniqueOrThrow({
    where: { id: timesheetId },
    select: {
      employee: {
        select: {
          id: true,
          tenantId: true,
          payType: true,
          hireDate: true,
          adjustedHireDate: true,
          dateOfBirth: true,
          site: { select: { timezone: true } },
          shift: {
            select: {
              startTime: true,
              endTime: true,
              workDays: true,
              mealConfig: true,
              breakConfig: true,
            },
          },
          holidayRule: {
            select: {
              id: true,
              payCodeId: true,
              creditMethod: true,
              creditMinutes: true,
              maxCreditMinutes: true,
              payBucket: true,
              workingPremium: true,
              requireDayBefore: true,
              requireDayAfter: true,
              requireDayBeforeOrAfter: true,
              minPeriodMinutes: true,
              mustNotWorkOnHoliday: true,
              payNonWorkingHolidayOnly: true,
              requireDaysWorkedEnabled: true,
              requireDaysWorkedCount: true,
              requireDaysWorkedPeriod: true,
              requireDaysWorkedPeriodUnit: true,
              requireDaysWorkedMinDailyHours: true,
              requireScheduledHoursPct: true,
              requireScheduledHoursPctValue: true,
              bypassAfterEligibility: true,
              excludedWeekDays: true,
              countTowardOt: true,
              includeOnProbation: true,
              probationDays: true,
              tenureRequiredEnabled: true,
              tenureRequiredDays: true,
              tenureRequiredBasis: true,
              tenureRequiredUnit: true,
              prorateEnabled: true,
              prorateLookbackDays: true,
              prorateIncludeCurrentWeek: true,
              prorateAppliedRule: true,
              prorateThresholdHours: true,
              prorateMultiplier: true,
              prorateAverageDailyMaxHours: true,
              prorateExcludeOt: true,
              postWorkingHoursToAccrual: true,
              postWorkingHoursMax: true,
              postWorkingHoursExcessEnabled: true,
              postWorkingHoursExcessMin: true,
              accrualCode: true,
              birthdayIsHoliday: true,
              holidayOverridesEnabled: true,
              holidayOverrides: true,
            },
          },
        },
      },
      payPeriod: { select: { startDate: true, endDate: true } },
    },
  });
  const timezone = timesheet.employee.site?.timezone ?? "UTC";
  const tenantId = timesheet.employee.tenantId;
  const isSalary = timesheet.employee.payType === "SALARY";

  // When this rule set became active mid-period (employee promotion/transfer),
  // autopay credits should only apply from that date forward; days before it
  // were punch-based and already have real segments.
  const midPeriodEntry = await db.employeeRuleSetHistory.findFirst({
    where: {
      employeeId: timesheet.employee.id,
      ruleSetId: ruleSet.id,
      effectiveDate: {
        gt: timesheet.payPeriod.startDate,
        lte: timesheet.payPeriod.endDate,
      },
    },
    orderBy: { effectiveDate: "desc" },
  });
  const autoPayCreditsFrom = midPeriodEntry?.effectiveDate ?? undefined;

  const punches = await db.punch.findMany({
    where: { timesheetId, isApproved: true, correctedById: null },
    orderBy: { roundedTime: "asc" },
  });

  // If the first approved punch in this period has stateBefore !== OUT, the employee
  // clocked in during a previous period. Seed computeSegments with the period's own
  // startDate so only hours earned here are credited.
  const firstPunch = punches[0];
  const carryIn =
    firstPunch && firstPunch.stateBefore !== "OUT"
      ? { openStart: timesheet.payPeriod.startDate, openState: firstPunch.stateBefore as ActiveState }
      : undefined;

  const rawSegments = computeSegments(timesheetId, punches, timezone, timesheet.payPeriod.startDate, carryIn);

  // Merge shift-level meal config on top of rule set defaults.
  // When a shift is assigned, the shift's mealConfig is authoritative:
  //   - shiftMeal.autoDeduct = true/false → use that value
  //   - shiftMeal is null (shift assigned but no meal config saved) → no auto-deduct
  // Only fall back to ruleSet.autoDeductMeal when no shift is assigned at all.
  const hasShift = !!timesheet.employee.shift;
  const shiftMeal = timesheet.employee.shift?.mealConfig as MealConfig | null | undefined;
  const shiftFirstMeal = shiftMeal?.meals?.[0];
  const effectiveAutoDeductMeal = hasShift
    ? (shiftMeal?.autoDeduct ?? false)
    : ruleSet.autoDeductMeal;
  const effectiveMealCfg: EffectiveMealCfg = {
    mealBreakAfterMinutes: shiftMeal?.autoDeduct && shiftFirstMeal
      ? Math.round(shiftFirstMeal.workAtLeastHours * 60)
      : ruleSet.mealBreakAfterMinutes,
    mealBreakMinutes: shiftMeal?.autoDeduct && shiftFirstMeal
      ? shiftFirstMeal.deductMinutes
      : ruleSet.mealBreakMinutes,
    minMealMinutes: shiftMeal?.minMealMinutes ?? 0,
    maxMealMinutes: shiftMeal?.maxMealMinutes ?? Infinity,
    disableMinDeduction: shiftMeal?.disableMinDeduction ?? false,
  };

  // Validate real MEAL punch gaps against shift rules (only meaningful when a shift
  // with configured bounds is assigned). Runs before auto-deduct so invalid gaps
  // become WORK and still trigger the synthetic deduction on that day.
  let segments = shiftMeal ? applyMealPunchValidation(rawSegments, effectiveMealCfg) : rawSegments;

  if (effectiveAutoDeductMeal) {
    const waivers = await db.mealWaiver.findMany({ where: { timesheetId } });
    const waivedDates = new Set(
      waivers.map((w) => format(w.segmentDate, "yyyy-MM-dd"))
    );
    segments = applyAutoMealDeduction(segments, effectiveMealCfg, waivedDates);
  }

  // Pair rounding runs after meal deduction so the rounded total already excludes unpaid breaks
  if (ruleSet.pairRoundingEnabled) {
    segments = applyPairRounding(segments, ruleSet);
  }

  // Meal break premiums: detect days where no qualifying meal was taken and credit
  // the configured penalty pay code. Runs after all deduction logic is settled.
  if (ruleSet.mealBreakPremiumEnabled) {
    const premiumWaivers = await db.mealPremiumWaiver.findMany({ where: { timesheetId } });
    const premiumWaivedStarts = new Set(premiumWaivers.map((w) => w.segmentStart.toISOString()));
    const premiumSegs = computeMealPremiums(timesheetId, segments, punches, ruleSet, timezone, premiumWaivedStarts);
    segments = [...segments, ...premiumSegs];
  }

  // Apply pay code to all punch-derived WORK segments.
  // When the rule set has autopay enabled, use autoPayPayCodeId (falling back to
  // defaultPayCodeId) so punch days and autopay-credit days carry the same pay code.
  // Without autopay, use defaultPayCodeId.
  const workPayCodeId = ruleSet.autoPayEnabled
    ? (ruleSet.autoPayPayCodeId ?? ruleSet.defaultPayCodeId)
    : ruleSet.defaultPayCodeId;

  if (workPayCodeId) {
    segments = segments.map((seg) =>
      seg.segmentType === "WORK" ? { ...seg, payCodeId: workPayCodeId } : seg
    );
  }

  // Dates that will have fresh WORK segments after this rebuild.
  const newSegmentDates = new Set(
    segments
      .filter((s) => s.segmentType === "WORK")
      .map((s) => format(s.segmentDate, "yyyy-MM-dd"))
  );

  // For missed-punch days (no new WORK segment), capture the pay code that was on
  // the existing WORK segment so we can re-create it as a 0-duration LEAVE marker.
  // Skip dates that already have a LEAVE marker — they're either manually set or
  // already preserved from a prior rebuild.
  const [existingWorkWithPayCode, existingLeaveMarkers] = await Promise.all([
    db.workSegment.findMany({
      where: { timesheetId, segmentType: "WORK", payCodeId: { not: null } },
      select: { segmentDate: true, payCodeId: true },
    }),
    db.workSegment.findMany({
      where: { timesheetId, segmentType: "LEAVE", durationMinutes: 0 },
      select: { segmentDate: true, id: true, payCodeId: true },
    }),
  ]);
  const existingLeaveDates = new Set(existingLeaveMarkers.map((s) => format(s.segmentDate, "yyyy-MM-dd")));
  const payCodeMarkers = existingWorkWithPayCode
    .filter((s) => {
      const key = format(s.segmentDate, "yyyy-MM-dd");
      return !newSegmentDates.has(key) && !existingLeaveDates.has(key);
    })
    .reduce<Map<string, string>>((acc, s) => {
      const key = format(s.segmentDate, "yyyy-MM-dd");
      if (!acc.has(key)) acc.set(key, s.payCodeId!);
      return acc;
    }, new Map());

  // For brand-new missed-punch days (first miss — no prior WORK segment and no LEAVE
  // marker), seed a LEAVE marker from the CLOCK_IN punch's pay code, or fall back to
  // the tenant's code-0 so the day shows Regular Hours rather than Absent.
  const todayLocalStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const needsDefault = punches.some((p) => {
    if (p.punchType !== "CLOCK_IN") return false;
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(p.roundedTime);
    return d < todayLocalStr && !newSegmentDates.has(d) && !existingLeaveDates.has(d) && !payCodeMarkers.has(d);
  });
  if (needsDefault && tenantId) {
    const defaultPayCode = await db.payCode.findUnique({
      where: { tenantId_code: { tenantId, code: 0 } },
      select: { id: true, isActive: true },
    });
    if (defaultPayCode?.isActive) {
      for (const punch of punches) {
        if (punch.punchType !== "CLOCK_IN") continue;
        const d = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(punch.roundedTime);
        if (d >= todayLocalStr || newSegmentDates.has(d) || existingLeaveDates.has(d) || payCodeMarkers.has(d)) continue;
        payCodeMarkers.set(d, punch.payCodeId ?? defaultPayCode.id);
      }
    }
  }

  // Rebuild segments in a transaction. LEAVE markers are intentionally excluded from
  // the deleteMany so manually-set absent-day pay codes survive. The exception: stale
  // 0-duration markers for days that now have a real work segment are cleaned up so
  // the WORK segment takes precedence in the timecard view.
  await db.$transaction([
    db.workSegment.deleteMany({
      where: { timesheetId, segmentType: { in: ["WORK", "MEAL", "BREAK", "HOLIDAY", "MEAL_PREMIUM"] } },
    }),
    ...(newSegmentDates.size > 0
      ? [
          db.workSegment.deleteMany({
            where: {
              timesheetId,
              segmentType: "LEAVE",
              durationMinutes: 0,
              segmentDate: { in: Array.from(newSegmentDates).map((s) => new Date(s + "T00:00:00.000Z")) },
            },
          }),
        ]
      : []),
    ...(segments.length > 0 ? [db.workSegment.createMany({ data: segments })] : []),
  ]);

  // Persist pay codes for missed-punch days as 0-duration LEAVE markers so they
  // survive future rebuilds (deleteMany never touches LEAVE segments).
  // Delete before insert to prevent duplicates from concurrent recalculation calls.
  if (payCodeMarkers.size > 0) {
    const markerDates = Array.from(payCodeMarkers.keys()).map((s) => new Date(s + "T00:00:00.000Z"));
    await db.workSegment.deleteMany({
      where: { timesheetId, segmentType: "LEAVE", durationMinutes: 0, segmentDate: { in: markerDates } },
    });
    await db.workSegment.createMany({
      data: Array.from(payCodeMarkers.entries()).map(([dateStr, payCodeId]) => {
        const date = new Date(dateStr + "T00:00:00.000Z");
        return {
          timesheetId,
          segmentType: "LEAVE" as const,
          startTime: date,
          endTime: date,
          durationMinutes: 0,
          segmentDate: date,
          isPaid: false,
          payBucket: "REG" as const,
          payCodeId,
        };
      }),
    });
  }

  // Backfill any existing LEAVE markers that have no payCodeId (created before this
  // logic existed) so they show Regular Hours rather than "Absent" in the timecard.
  if (tenantId) {
    const nullCodeMarkers = existingLeaveMarkers.filter((s) => {
      const key = format(s.segmentDate, "yyyy-MM-dd");
      return s.payCodeId === null && !newSegmentDates.has(key);
    });
    if (nullCodeMarkers.length > 0) {
      const regularCode = await db.payCode.findUnique({
        where: { tenantId_code: { tenantId, code: 0 } },
        select: { id: true, isActive: true },
      });
      if (regularCode?.isActive) {
        await db.workSegment.updateMany({
          where: { id: { in: nullCodeMarkers.map((s) => s.id) } },
          data: { payCodeId: regularCode.id },
        });
      }
    }
  }

  // Guaranteed hours / auto-pay: fill in configured daily credits for uncovered days.
  // When autoPayEnabled, uses the rule set's configurable settings.
  // Otherwise falls back to legacy 8 h/day behavior for salary employees.
  if (ruleSet.autoPayEnabled && isSalary) {
    await applyAutoPayCredits(
      timesheetId,
      timesheet.payPeriod.startDate,
      timesheet.payPeriod.endDate,
      ruleSet,
      timesheet.employee.shift ?? null,
      autoPayCreditsFrom,
    );
  } else if (isSalary) {
    await ensureSalarySegments(
      timesheetId,
      timesheet.payPeriod.startDate,
      timesheet.payPeriod.endDate,
      ruleSet.defaultPayCodeId,
      autoPayCreditsFrom,
    );
  }

  // OT engine reads the fresh segments and writes REG/OT/DT buckets.
  await applyOvertime(timesheetId, ruleSet, timesheet.employee.shift ?? null, timezone);

  // Holiday credits: delete any stale HOLIDAY bucket, then recompute from rule.
  await db.overtimeBucket.deleteMany({ where: { timesheetId, bucket: "HOLIDAY" } });
  if (timesheet.employee.holidayRule && tenantId) {
    const _hr = timesheet.employee.holidayRule;
    await syncHolidayCredits(
      timesheetId,
      timezone,
      timesheet.payPeriod.startDate,
      timesheet.payPeriod.endDate,
      punches,
      {
        ..._hr,
        requireDaysWorkedMinDailyHours: Number(_hr.requireDaysWorkedMinDailyHours),
        prorateThresholdHours:    Number(_hr.prorateThresholdHours),
        prorateMultiplier:        Number(_hr.prorateMultiplier),
        prorateAverageDailyMaxHours: Number(_hr.prorateAverageDailyMaxHours),
        postWorkingHoursMax:      Number(_hr.postWorkingHoursMax),
        postWorkingHoursExcessMin: Number(_hr.postWorkingHoursExcessMin),
      },
      tenantId,
      timesheet.employee.shift ?? null,
      {
        id:              timesheet.employee.id,
        hireDate:        timesheet.employee.hireDate,
        adjustedHireDate: timesheet.employee.adjustedHireDate,
        dateOfBirth:     timesheet.employee.dateOfBirth,
      },
      ruleSet.weekStartDay
    );
    if (timesheet.employee.holidayRule.countTowardOt) {
      await applyHolidayOtAdjustment(timesheetId, ruleSet);
    }
  }

  // Auto-assign the tenant's code-0 (Regular Hours) PayCode to REG WORK segments
  // that don't already have a pay code set.
  if (tenantId) {
    const regularPayCode = await db.payCode.findUnique({
      where: { tenantId_code: { tenantId, code: 0 } },
      select: { id: true, isActive: true },
    });
    if (regularPayCode?.isActive) {
      await db.workSegment.updateMany({
        where: {
          timesheetId,
          segmentType: "WORK",
          payCodeId: null,
        },
        data: { payCodeId: regularPayCode.id },
      });
    }
  }

  // Re-apply pay codes stored on CLOCK_IN punches and reconcile any leave deductions.
  // Runs after the code-0 auto-assign so leave-type pay codes correctly override it.
  if (tenantId && timesheet.employee.id) {
    await reconcileLeaveDeductions(timesheetId, timesheet.employee.id, tenantId);
  }

  // Sync ABSENT exceptions for past days in the pay period with no activity.
  await syncAbsentExceptions(
    timesheetId,
    timezone,
    timesheet.payPeriod.startDate,
    timesheet.payPeriod.endDate,
    punches,
    timesheet.employee.shift?.workDays
  );

  // Sync MISSING_PUNCH exceptions for past days where the shift was left open.
  await syncMissingPunchExceptions(
    timesheetId,
    timezone,
    timesheet.payPeriod.startDate,
    timesheet.payPeriod.endDate,
    punches
  );

}

/**
 * Creates ABSENT exceptions for past days in the pay period that have no punch
 * or leave activity, and auto-resolves open ABSENT exceptions for days that now
 * have activity.
 */
async function syncAbsentExceptions(
  timesheetId: string,
  timezone: string,
  payPeriodStart: Date,
  payPeriodEnd: Date,
  punches: Punch[],
  shiftWorkDays?: number[]
): Promise<void> {
  // Calendar date strings (YYYY-MM-DD) for the period bounds and today in site timezone.
  const periodStartStr = format(payPeriodStart, "yyyy-MM-dd");
  const periodEndStr = format(payPeriodEnd, "yyyy-MM-dd");
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  // Build set of days that have at least one approved punch (local timezone).
  const punchedDays = new Set(
    punches.map((p) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(p.roundedTime)
    )
  );

  // Build set of days that have a LEAVE segment (stored as UTC midnight date).
  const leaveSegs = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "LEAVE" },
    select: { segmentDate: true },
  });
  const leaveDays = new Set(leaveSegs.map((s) => format(s.segmentDate, "yyyy-MM-dd")));

  // Build set of days that have a WORK or HOLIDAY segment (covers salary auto-credits and holiday credits).
  const workSegs = await db.workSegment.findMany({
    where: { timesheetId, segmentType: { in: ["WORK", "HOLIDAY"] } },
    select: { segmentDate: true },
  });
  const workDays = new Set(workSegs.map((s) => format(s.segmentDate, "yyyy-MM-dd")));

  // Collect all past calendar days in the pay period that have no activity.
  const absentDays = new Set<string>();
  let dateStr = periodStartStr;
  while (dateStr < todayStr && dateStr < periodEndStr) {
    const dow = new Date(dateStr + "T12:00:00.000Z").getUTCDay();
    const isScheduledDay = !shiftWorkDays || shiftWorkDays.includes(dow);
    if (isScheduledDay && !punchedDays.has(dateStr) && !leaveDays.has(dateStr) && !workDays.has(dateStr)) {
      absentDays.add(dateStr);
    }
    const d = new Date(dateStr + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + 1);
    dateStr = d.toISOString().slice(0, 10);
  }

  // Fetch all currently open ABSENT exceptions for this timesheet.
  const openExceptions = await db.exception.findMany({
    where: { timesheetId, exceptionType: "ABSENT", resolvedAt: null },
    select: { id: true, occurredAt: true },
  });
  const openByDate = new Map<string, string>(
    openExceptions.map((e) => [format(e.occurredAt, "yyyy-MM-dd"), e.id])
  );

  // Create an exception for each absent day that has no open exception yet.
  for (const ds of absentDays) {
    if (!openByDate.has(ds)) {
      // Use noon UTC so the date displays correctly in any timezone (UTC midnight
      // would appear as the previous evening in negative-offset timezones like EDT).
      const occurredAt = new Date(ds + "T12:00:00.000Z");
      await db.exception.create({
        data: {
          timesheetId,
          exceptionType: "ABSENT",
          description: `No activity recorded on ${new Intl.DateTimeFormat("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: timezone,
          }).format(occurredAt)}`,
          occurredAt,
        },
      });
    }
  }

  // Auto-resolve open ABSENT exceptions for days that now have activity.
  for (const [ds, exId] of openByDate) {
    if (!absentDays.has(ds)) {
      await db.exception.update({
        where: { id: exId },
        data: {
          resolvedAt: new Date(),
          resolution: "Auto-resolved: activity recorded for this day",
        },
      });
    }
  }
}

/**
 * Creates MISSING_PUNCH exceptions for past days where the shift was left open
 * (employee punched in but never punched out by end of day), and auto-resolves
 * open MISSING_PUNCH exceptions for days where the shift is now complete.
 *
 * A midnight-spanning shift is NOT flagged: if there are subsequent punches after
 * end-of-day, it means the shift legitimately continued into the next day.
 */
async function syncMissingPunchExceptions(
  timesheetId: string,
  timezone: string,
  payPeriodStart: Date,
  payPeriodEnd: Date,
  punches: Punch[]
): Promise<void> {
  if (punches.length === 0) return;

  const periodStartStr = format(payPeriodStart, "yyyy-MM-dd");
  const periodEndStr = format(payPeriodEnd, "yyyy-MM-dd");
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const localDateOf = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);

  // Group punches by local date, sorted ascending within each day.
  const punchesByDay = new Map<string, Punch[]>();
  for (const p of punches) {
    const ds = localDateOf(p.roundedTime);
    const list = punchesByDay.get(ds) ?? [];
    list.push(p);
    punchesByDay.set(ds, list);
  }
  for (const list of punchesByDay.values()) {
    list.sort((a, b) => a.roundedTime.getTime() - b.roundedTime.getTime());
  }

  // Find past days with an incomplete punch sequence.
  // missingPunchDays maps date string → description of what's missing.
  const missingPunchDays = new Map<string, string>();
  let dateStr = periodStartStr;
  while (dateStr < todayStr && dateStr < periodEndStr) {
    const dayPunches = punchesByDay.get(dateStr);
    if (dayPunches && dayPunches.length > 0) {
      const firstPunch = dayPunches[0];
      const lastPunch = dayPunches[dayPunches.length - 1];
      const missingIn = firstPunch.stateBefore !== "OUT";
      const missingOut = lastPunch.stateAfter !== "OUT";
      if (missingIn || missingOut) {
        const what =
          missingIn && missingOut ? "a punch-in and punch-out" :
          missingIn ? "a punch-in" : "a punch-out";
        missingPunchDays.set(dateStr, what);
      }
    }
    const d = new Date(dateStr + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + 1);
    dateStr = d.toISOString().slice(0, 10);
  }

  // Fetch existing open auto-generated MISSING_PUNCH exceptions (occurredAt at UTC midnight).
  // Manual ones (from punch.actions.ts) use the actual punch time, so format() will match
  // the same date string and correctly de-duplicate.
  const openExceptions = await db.exception.findMany({
    where: { timesheetId, exceptionType: "MISSING_PUNCH", resolvedAt: null },
    select: { id: true, occurredAt: true },
  });
  const openByDate = new Map<string, string>(
    openExceptions.map((e) => [format(e.occurredAt, "yyyy-MM-dd"), e.id])
  );

  // Create exceptions for missing-punch days with no open exception yet.
  for (const [ds, what] of missingPunchDays) {
    if (!openByDate.has(ds)) {
      // Use noon UTC so the date displays correctly in any timezone (UTC midnight
      // would appear as the previous evening in negative-offset timezones like EDT).
      const occurredAt = new Date(ds + "T12:00:00.000Z");
      await db.exception.create({
        data: {
          timesheetId,
          exceptionType: "MISSING_PUNCH",
          description: `Shift on ${new Intl.DateTimeFormat("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: timezone,
          }).format(occurredAt)} is missing ${what}`,
          occurredAt,
        },
      });
    }
  }

  // For days with a missing punch-out the employee's punch state is left as non-OUT,
  // which causes their next kiosk scan to be mis-detected as CLOCK_OUT instead of CLOCK_IN.
  // Create a SYSTEM unapproved CLOCK_OUT to reset their state to OUT so the next morning
  // scan is correctly identified as CLOCK_IN. The unapproved flag ensures it is excluded
  // from segment and hours calculations until payroll fills in the real time.
  const employeeId = punches[0]?.employeeId;
  if (employeeId) {
    for (const [ds] of missingPunchDays) {
      const dayPunches = punchesByDay.get(ds)!;
      const lastPunch = dayPunches[dayPunches.length - 1];
      if (lastPunch.stateAfter === "OUT") continue; // already OUT — no reset needed

      // End-of-day marker: 23:59:59 Eastern Time (America/New_York)
      const eodTime = endOfDayInTz(ds, "America/New_York");

      const alreadyExists = await db.punch.findFirst({
        where: { employeeId, timesheetId, isApproved: false, source: "SYSTEM", punchType: "CLOCK_OUT", roundedTime: eodTime },
        select: { id: true },
      });
      if (!alreadyExists) {
        await db.punch.create({
          data: {
            employeeId,
            timesheetId,
            punchType: "CLOCK_OUT",
            punchTime: eodTime,
            roundedTime: eodTime,
            source: "SYSTEM",
            stateBefore: lastPunch.stateAfter,
            stateAfter: "OUT",
            isApproved: false,
            note: "Auto-generated: missing punch-out — state reset pending payroll correction",
          },
        });
      }
    }
  }

  // Auto-resolve open MISSING_PUNCH exceptions for days where the shift is now complete.
  for (const [ds, exId] of openByDate) {
    if (!missingPunchDays.has(ds)) {
      await db.exception.update({
        where: { id: exId },
        data: {
          resolvedAt: new Date(),
          resolution: "Auto-resolved: punch sequence completed for this day",
        },
      });
    }
  }
}

/**
 * Inserts HOLIDAY-type WorkSegments for each qualifying holiday in the pay period:
 *  - A credit segment (FIXED / ACTUAL_WORKED / SCHEDULED_HOURS hours at the rule's payBucket)
 *  - A premium segment for any hours actually worked on the holiday (workingPremium - 100)/100 × worked
 *
 * Called after applyOvertime() so HOLIDAY segments are not touched by the OT engine,
 * and after the HOLIDAY OvertimeBucket has been cleared by the caller.
 */
async function syncHolidayCredits(
  timesheetId: string,
  timezone: string,
  payPeriodStart: Date,
  payPeriodEnd: Date,
  punches: Punch[],
  rule: {
    id: string;
    payCodeId: string | null;
    creditMethod: HolidayCreditMethod;
    creditMinutes: number;
    maxCreditMinutes: number;
    payBucket: PayBucket;
    workingPremium: number;
    requireDayBefore: boolean;
    requireDayAfter: boolean;
    requireDayBeforeOrAfter: boolean;
    minPeriodMinutes: number;
    mustNotWorkOnHoliday: boolean;
    payNonWorkingHolidayOnly: boolean;
    requireDaysWorkedEnabled: boolean;
    requireDaysWorkedCount: number;
    requireDaysWorkedPeriod: number;
    requireDaysWorkedPeriodUnit: string;
    requireDaysWorkedMinDailyHours: number;
    requireScheduledHoursPct: boolean;
    requireScheduledHoursPctValue: number;
    bypassAfterEligibility: boolean;
    excludedWeekDays: number[];
    countTowardOt: boolean;
    includeOnProbation: boolean;
    probationDays: number;
    tenureRequiredEnabled: boolean;
    tenureRequiredDays: number;
    tenureRequiredBasis: string;
    tenureRequiredUnit: string;
    prorateEnabled: boolean;
    prorateLookbackDays: number;
    prorateIncludeCurrentWeek: boolean;
    prorateAppliedRule: string;
    prorateThresholdHours: number;
    prorateMultiplier: number;
    prorateAverageDailyMaxHours: number;
    prorateExcludeOt: boolean;
    postWorkingHoursToAccrual: boolean;
    postWorkingHoursMax: number;
    postWorkingHoursExcessEnabled: boolean;
    postWorkingHoursExcessMin: number;
    accrualCode: string | null;
    birthdayIsHoliday: boolean;
    holidayOverridesEnabled: boolean;
    holidayOverrides: unknown;
  },
  tenantId: string,
  shift: { startTime: string; endTime: string; workDays: number[] } | null,
  employee: {
    id: string;
    hireDate: Date;
    adjustedHireDate: Date | null;
    dateOfBirth: Date | null;
  },
  weekStartDay: number
): Promise<void> {
  // If the rule has specific holidays assigned, only credit those.
  // Otherwise fall back to all active tenant holidays (backward-compatible for unconfigured rules).
  const assignedCount = await db.holidayRuleHoliday.count({ where: { holidayRuleId: rule.id } });

  const holidays = await db.holiday.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(assignedCount > 0 ? { holidayRules: { some: { holidayRuleId: rule.id } } } : {}),
      OR: [
        { date:         { gte: payPeriodStart, lte: payPeriodEnd } },
        { observedDate: { gte: payPeriodStart, lte: payPeriodEnd } },
      ],
    },
    select: { date: true, observedDate: true, bypassAfterEligibility: true },
  });

  const periodStartStr = format(payPeriodStart, "yyyy-MM-dd");
  const periodEndStr   = format(payPeriodEnd,   "yyyy-MM-dd");
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const localDateOf = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);

  // Effective holiday dates — use observedDate when set; track per-holiday bypass flag
  const holidayBypassAfter = new Map<string, boolean>();
  for (const h of holidays) {
    const ds = format(h.observedDate ?? h.date, "yyyy-MM-dd");
    holidayBypassAfter.set(ds, h.bypassAfterEligibility);
  }

  // Birthday holiday — employee's birthday treated as a floating holiday under this rule
  if (rule.birthdayIsHoliday && employee.dateOfBirth) {
    const dob = employee.dateOfBirth;
    const dobMonth = dob.getUTCMonth();
    const dobDay   = dob.getUTCDate();
    const d = new Date(payPeriodStart);
    while (d <= payPeriodEnd) {
      if (d.getUTCMonth() === dobMonth && d.getUTCDate() === dobDay) {
        const ds = d.toISOString().slice(0, 10);
        if (!holidayBypassAfter.has(ds)) holidayBypassAfter.set(ds, false);
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }

  if (holidayBypassAfter.size === 0) return;
  const holidayDates = new Set(holidayBypassAfter.keys());

  // Paid WORK segments — include payBucket to separate REG from OT for prorate
  const workSegs = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "WORK", isPaid: true },
    select: { segmentDate: true, durationMinutes: true, payBucket: true },
  });
  const workedMinsByDay = new Map<string, number>(); // REG + OT + DT
  const regMinsByDay    = new Map<string, number>(); // REG only (for prorateExcludeOt)
  for (const seg of workSegs) {
    const ds = format(seg.segmentDate, "yyyy-MM-dd");
    workedMinsByDay.set(ds, (workedMinsByDay.get(ds) ?? 0) + seg.durationMinutes);
    if (seg.payBucket === "REG") {
      regMinsByDay.set(ds, (regMinsByDay.get(ds) ?? 0) + seg.durationMinutes);
    }
  }

  // Minimum period check
  const totalWorkedMins = [...workedMinsByDay.values()].reduce((a, b) => a + b, 0);
  if (rule.minPeriodMinutes > 0 && totalWorkedMins < rule.minPeriodMinutes) return;

  // Days with any activity (for requireDayBefore/After checks)
  const punchedDays  = new Set(punches.map((p) => localDateOf(p.roundedTime)));
  const activityDays = new Set([...punchedDays, ...workedMinsByDay.keys()]);

  // Shift duration for SCHEDULED_HOURS credit (fallback to rule's creditMinutes if no shift)
  let shiftDurationMins = rule.creditMinutes;
  if (shift) {
    const [sh, sm] = shift.startTime.split(":").map(Number);
    const [eh, em] = shift.endTime.split(":").map(Number);
    let endMins = eh * 60 + em;
    const startMins = sh * 60 + sm;
    if (endMins <= startMins) endMins += 1440; // overnight
    shiftDurationMins = endMins - startMins;
  }

  // Walk to the nearest adjacent scheduled work day, skipping holidays, off-schedule days,
  // and any day-of-week in excludedWeekDays.
  function adjacentWorkDay(fromDs: string, dir: 1 | -1): string {
    const d = new Date(fromDs + "T12:00:00.000Z");
    for (let i = 0; i < 14; i++) {
      d.setUTCDate(d.getUTCDate() + dir);
      const ds = d.toISOString().slice(0, 10);
      const dow = new Date(ds + "T12:00:00.000Z").getUTCDay();
      const onSchedule = !shift || shift.workDays.includes(dow);
      if (onSchedule && !rule.excludedWeekDays.includes(dow) && !holidayDates.has(ds)) return ds;
    }
    return "";
  }

  // Returns true if the employee worked at least requireScheduledHoursPctValue% of their
  // scheduled hours on the given day.
  function meetsScheduledHoursPct(ds: string): boolean {
    if (!rule.requireScheduledHoursPct || shiftDurationMins <= 0) return true;
    return (workedMinsByDay.get(ds) ?? 0) / shiftDurationMins >= rule.requireScheduledHoursPctValue / 100;
  }

  // Returns true if the employee worked at least requireDaysWorkedCount qualifying days
  // in the window immediately before the holiday (limited to the current pay period).
  function meetsRequiredDaysWorked(holidayDs: string): boolean {
    if (!rule.requireDaysWorkedEnabled || rule.requireDaysWorkedCount <= 0) return true;
    const unitDays = rule.requireDaysWorkedPeriodUnit === "WEEK" ? 7 : 1;
    const windowSize = rule.requireDaysWorkedPeriod * unitDays;
    const windowEndDate = new Date(holidayDs + "T00:00:00.000Z");
    windowEndDate.setUTCDate(windowEndDate.getUTCDate() - 1);
    const windowStartDate = new Date(windowEndDate);
    windowStartDate.setUTCDate(windowStartDate.getUTCDate() - windowSize + 1);
    const windowStartStr = windowStartDate.toISOString().slice(0, 10);
    const windowEndStr   = windowEndDate.toISOString().slice(0, 10);
    const minMins = Math.round(rule.requireDaysWorkedMinDailyHours * 60);

    let count = 0;
    for (const [ds, mins] of workedMinsByDay) {
      if (ds < windowStartStr || ds > windowEndStr) continue;
      if (rule.excludedWeekDays.includes(new Date(ds + "T12:00:00.000Z").getUTCDay())) continue;
      if (minMins > 0 && mins < minMins) continue;
      count++;
    }
    return count >= rule.requireDaysWorkedCount;
  }

  // Returns true when the employee has sufficient tenure before the holiday.
  function meetsTenure(holidayDs: string): boolean {
    if (!rule.tenureRequiredEnabled || rule.tenureRequiredDays <= 0) return true;
    const basisDate = rule.tenureRequiredBasis === "ADJUSTED_HIRE_DATE"
      ? (employee.adjustedHireDate ?? employee.hireDate)
      : employee.hireDate;
    const holidayDate = new Date(holidayDs + "T00:00:00.000Z");
    if (rule.tenureRequiredUnit === "MONTHS") {
      const yDiff = holidayDate.getUTCFullYear() - basisDate.getUTCFullYear();
      const mDiff = holidayDate.getUTCMonth()    - basisDate.getUTCMonth();
      const dDiff = holidayDate.getUTCDate()     - basisDate.getUTCDate();
      const months = yDiff * 12 + mDiff + (dDiff < 0 ? -1 : 0);
      return months >= rule.tenureRequiredDays;
    }
    const diffDays = Math.floor((holidayDate.getTime() - basisDate.getTime()) / 86_400_000);
    return diffDays >= rule.tenureRequiredDays;
  }

  // Returns true when the employee is still in their probationary period.
  function isInProbation(holidayDs: string): boolean {
    if (!rule.probationDays || rule.probationDays <= 0) return false;
    const holidayDate = new Date(holidayDs + "T00:00:00.000Z");
    const diffDays = Math.floor((holidayDate.getTime() - employee.hireDate.getTime()) / 86_400_000);
    return diffDays < rule.probationDays;
  }

  // Prorate the base credit amount based on the employee's average daily hours over
  // the lookback window (limited to the current pay period).
  function applyProrate(baseCreditMins: number, holidayDs: string): number {
    if (!rule.prorateEnabled || baseCreditMins <= 0) return baseCreditMins;

    const holidayDate = new Date(holidayDs + "T00:00:00.000Z");

    // Window end: day before the holiday (optionally further back to exclude current week)
    let windowEndDate = new Date(holidayDate);
    windowEndDate.setUTCDate(windowEndDate.getUTCDate() - 1);
    if (!rule.prorateIncludeCurrentWeek) {
      const dow = holidayDate.getUTCDay();
      const diffToWeekStart = (dow - weekStartDay + 7) % 7;
      const currentWeekStart = new Date(holidayDate);
      currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - diffToWeekStart);
      currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 1); // day before week start
      if (currentWeekStart < windowEndDate) windowEndDate = currentWeekStart;
    }

    const windowStartDate = new Date(windowEndDate);
    windowStartDate.setUTCDate(windowStartDate.getUTCDate() - rule.prorateLookbackDays + 1);
    if (windowStartDate < payPeriodStart) windowStartDate.setTime(payPeriodStart.getTime());

    if (windowStartDate > windowEndDate) return baseCreditMins; // no valid window → full credit

    const workDays = shift ? shift.workDays : [1, 2, 3, 4, 5];
    const dayMinsMap = rule.prorateExcludeOt ? regMinsByDay : workedMinsByDay;
    let scheduledDays = 0;
    let totalMins = 0;
    const d = new Date(windowStartDate);
    while (d <= windowEndDate) {
      const ds = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      if (workDays.includes(dow) && !rule.excludedWeekDays.includes(dow) && !holidayDates.has(ds)) {
        scheduledDays++;
        totalMins += dayMinsMap.get(ds) ?? 0;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }

    if (scheduledDays === 0) return 0;
    const avgDailyMins = totalMins / scheduledDays;

    if (rule.prorateAppliedRule === "THRESHOLD") {
      const thresholdMins = rule.prorateThresholdHours * 60;
      if (thresholdMins <= 0 || avgDailyMins >= thresholdMins) return baseCreditMins;
      return Math.round(baseCreditMins * (avgDailyMins / thresholdMins));
    }
    // AVERAGE_DAILY: credit = min(avgDaily, maxDailyHours) × multiplier
    const capped = Math.min(avgDailyMins, rule.prorateAverageDailyMaxHours * 60);
    return Math.round(capped * rule.prorateMultiplier);
  }

  type HolidaySegInput = {
    timesheetId: string;
    segmentType: "HOLIDAY";
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
    segmentDate: Date;
    isPaid: boolean;
    payBucket: PayBucket;
    isSplit: boolean;
    payCodeId: string | null;
  };

  interface HolidayOverrideEntry { date: string; hours: number; payCodeId?: string }

  const toCreate: HolidaySegInput[] = [];
  // Accumulate worked-on-holiday minutes for postWorkingHoursToAccrual (keyed by holiday ds)
  const accrualMins: { ds: string; mins: number }[] = [];

  for (const ds of holidayDates) {
    if (ds < periodStartStr || ds >= periodEndStr) continue;
    if (ds >= todayStr) continue;

    const workedMinsOnHoliday = workedMinsByDay.get(ds) ?? 0;

    // mustNotWorkOnHoliday: if employee worked any hours on the holiday, skip entirely
    if (rule.mustNotWorkOnHoliday && workedMinsOnHoliday > 0) continue;

    // Tenure: employee must have been employed long enough before the holiday
    if (!meetsTenure(ds)) continue;

    // Probation: skip probationary employees unless the rule explicitly includes them
    if (!rule.includeOnProbation && isInProbation(ds)) continue;

    // requireDaysWorked: must have worked N qualifying days in the lookback window
    if (!meetsRequiredDaysWorked(ds)) continue;

    // bypassAfterEligibility: both the rule AND the specific holiday must have the flag set
    const bypassAfter = rule.bypassAfterEligibility && (holidayBypassAfter.get(ds) ?? false);

    // Day-before / day-after eligibility
    if (rule.requireDayBeforeOrAfter) {
      const prev = adjacentWorkDay(ds, -1);
      const prevOk = !!prev && activityDays.has(prev) && meetsScheduledHoursPct(prev);
      let afterOk = bypassAfter;
      if (!afterOk) {
        const next = adjacentWorkDay(ds, 1);
        afterOk = !!next && next < todayStr && activityDays.has(next) && meetsScheduledHoursPct(next);
      }
      if (!prevOk && !afterOk) continue;
    } else {
      if (rule.requireDayBefore) {
        const prev = adjacentWorkDay(ds, -1);
        if (!prev || !activityDays.has(prev) || !meetsScheduledHoursPct(prev)) continue;
      }
      if (rule.requireDayAfter && !bypassAfter) {
        const next = adjacentWorkDay(ds, 1);
        if (!next || next >= todayStr || !activityDays.has(next) || !meetsScheduledHoursPct(next)) continue;
      }
    }

    // Base credit amount
    let creditMins: number;
    let creditPayCodeId = rule.payCodeId ?? null;

    // Holiday overrides take priority over the base credit calculation
    const override = rule.holidayOverridesEnabled && Array.isArray(rule.holidayOverrides)
      ? (rule.holidayOverrides as HolidayOverrideEntry[]).find((o) => o.date === ds)
      : null;

    if (override) {
      creditMins = Math.round(override.hours * 60);
      if (override.payCodeId) creditPayCodeId = override.payCodeId;
    } else {
      if (rule.creditMethod === "ACTUAL_WORKED") {
        creditMins = workedMinsOnHoliday;
      } else if (rule.creditMethod === "SCHEDULED_HOURS") {
        creditMins = shiftDurationMins;
      } else {
        creditMins = rule.creditMinutes;
      }
      if (rule.maxCreditMinutes > 0) creditMins = Math.min(creditMins, rule.maxCreditMinutes);
      creditMins = applyProrate(creditMins, ds);
    }

    const segmentDate = new Date(ds + "T00:00:00.000Z");
    const creditStart = new Date(ds + "T00:00:00.000Z");

    // payNonWorkingHolidayOnly: only post credit segment if employee did NOT work the holiday
    if ((!rule.payNonWorkingHolidayOnly || workedMinsOnHoliday === 0) && creditMins > 0) {
      toCreate.push({
        timesheetId,
        segmentType: "HOLIDAY",
        startTime: creditStart,
        endTime: new Date(creditStart.getTime() + creditMins * 60_000),
        durationMinutes: creditMins,
        segmentDate,
        isPaid: true,
        payBucket: rule.payBucket,
        isSplit: false,
        payCodeId: creditPayCodeId,
      });
    }

    // Working premium — extra pay for hours actually clocked on the holiday.
    // Applies regardless of payNonWorkingHolidayOnly (premium covers worked hours, not credit).
    if (workedMinsOnHoliday > 0 && rule.workingPremium > 100) {
      const premiumMins = Math.round(workedMinsOnHoliday * (rule.workingPremium - 100) / 100);
      if (premiumMins > 0) {
        toCreate.push({
          timesheetId,
          segmentType: "HOLIDAY",
          startTime: creditStart,
          endTime: new Date(creditStart.getTime() + premiumMins * 60_000),
          durationMinutes: premiumMins,
          segmentDate,
          isPaid: true,
          payBucket: rule.payBucket,
          isSplit: false,
          payCodeId: creditPayCodeId,
        });
      }
    }

    // Accumulate for postWorkingHoursToAccrual (processed after segment creation)
    if (rule.postWorkingHoursToAccrual && rule.accrualCode && workedMinsOnHoliday > 0) {
      let minsToPost = workedMinsOnHoliday;
      if (rule.postWorkingHoursExcessEnabled) {
        const excessMin = Math.round(rule.postWorkingHoursExcessMin * 60);
        minsToPost = minsToPost > excessMin ? minsToPost - excessMin : 0;
      }
      if (rule.postWorkingHoursMax > 0) {
        minsToPost = Math.min(minsToPost, Math.round(rule.postWorkingHoursMax * 60));
      }
      if (minsToPost > 0) accrualMins.push({ ds, mins: minsToPost });
    }
  }

  if (toCreate.length > 0) {
    const totalHolidayMins = toCreate.reduce((a, s) => a + s.durationMinutes, 0);
    await db.$transaction([
      db.workSegment.createMany({ data: toCreate }),
      db.overtimeBucket.upsert({
        where: { timesheetId_bucket: { timesheetId, bucket: "HOLIDAY" } },
        create: { timesheetId, bucket: "HOLIDAY", totalMinutes: totalHolidayMins },
        update: { totalMinutes: totalHolidayMins },
      }),
    ]);
  }

  // Post worked-on-holiday hours to the configured accrual leave type
  if (accrualMins.length > 0 && rule.accrualCode) {
    const totalToPost = accrualMins.reduce((sum, e) => sum + e.mins, 0);
    const leaveType = await db.leaveType.findFirst({
      where: { id: rule.accrualCode, tenantId },
      select: { id: true },
    });
    if (leaveType) {
      const accrualYear = payPeriodEnd.getUTCFullYear();
      const currentBalance = await db.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_accrualYear: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            accrualYear,
          },
        },
        select: { balanceMinutes: true },
      });
      const balanceAfter = (currentBalance?.balanceMinutes ?? 0) + totalToPost;
      await db.$transaction([
        db.leaveBalance.upsert({
          where: {
            employeeId_leaveTypeId_accrualYear: {
              employeeId: employee.id,
              leaveTypeId: leaveType.id,
              accrualYear,
            },
          },
          create: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            accrualYear,
            balanceMinutes: totalToPost,
            usedMinutes: 0,
          },
          update: { balanceMinutes: { increment: totalToPost } },
        }),
        db.leaveAccrualLedger.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            action: "EARNED_ADJUSTMENT",
            deltaMinutes: totalToPost,
            balanceAfter,
            payPeriodEnd: payPeriodEnd,
            note: "Holiday worked hours",
          },
        }),
      ]);
    }
  }
}

/**
 * After holiday credits are written, reclassifies weekly REG WORK minutes that are
 * pushed over the OT threshold by the holiday credit hours (countTowardOt = true).
 * Works from the end of the week backwards, splitting segments when needed.
 */
async function applyHolidayOtAdjustment(
  timesheetId: string,
  ruleSet: { weeklyOtEnabled: boolean; weeklyOtMinutes: number; weekStartDay: number }
): Promise<void> {
  if (!ruleSet.weeklyOtEnabled || ruleSet.weeklyOtMinutes >= 86400) return;

  function weekStartOf(date: Date): string {
    const dow = date.getUTCDay();
    const diff = (dow - ruleSet.weekStartDay + 7) % 7;
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
  }

  const [regSegs, holidaySegs] = await Promise.all([
    db.workSegment.findMany({
      where: { timesheetId, segmentType: "WORK", payBucket: "REG", isPaid: true },
      select: { id: true, segmentDate: true, startTime: true, endTime: true, durationMinutes: true, payCodeId: true },
      orderBy: [{ segmentDate: "desc" }, { startTime: "desc" }],
    }),
    db.workSegment.findMany({
      where: { timesheetId, segmentType: "HOLIDAY", isPaid: true },
      select: { segmentDate: true, durationMinutes: true },
    }),
  ]);

  if (regSegs.length === 0 || holidaySegs.length === 0) return;

  // Minutes per week
  const weekReg = new Map<string, number>();
  const weekHol = new Map<string, number>();
  for (const s of regSegs)     weekReg.set(weekStartOf(s.segmentDate), (weekReg.get(weekStartOf(s.segmentDate)) ?? 0) + s.durationMinutes);
  for (const s of holidaySegs) weekHol.set(weekStartOf(s.segmentDate), (weekHol.get(weekStartOf(s.segmentDate)) ?? 0) + s.durationMinutes);

  // Overflow per week: how many REG minutes should become OT
  const weekOverflow = new Map<string, number>();
  for (const [wk, regMins] of weekReg) {
    const holMins = weekHol.get(wk) ?? 0;
    if (holMins === 0) continue;
    const overflow = Math.min((regMins + holMins) - ruleSet.weeklyOtMinutes, regMins);
    if (overflow > 0) weekOverflow.set(wk, overflow);
  }

  if (weekOverflow.size === 0) return;

  type SegUpdate = Parameters<typeof db.workSegment.update>[0];
  const ops: ReturnType<typeof db.workSegment.update>[] = [];
  const creates: {
    timesheetId: string; segmentType: "WORK"; startTime: Date; endTime: Date;
    durationMinutes: number; segmentDate: Date; isPaid: boolean; payBucket: "OT";
    isSplit: boolean; payCodeId: string | null;
  }[] = [];
  let totalReclassified = 0;

  for (const [wk, overflow] of weekOverflow) {
    let remaining = overflow;
    const weekSegs = regSegs.filter((s) => weekStartOf(s.segmentDate) === wk);

    for (const seg of weekSegs) {
      if (remaining <= 0) break;

      if (seg.durationMinutes <= remaining) {
        // Whole segment → OT
        ops.push(db.workSegment.update({ where: { id: seg.id }, data: { payBucket: "OT" } }));
        totalReclassified += seg.durationMinutes;
        remaining -= seg.durationMinutes;
      } else {
        // Partial: trim this segment to (duration - remaining) REG, create a new OT tail
        const otMins = remaining;
        const regMins = seg.durationMinutes - otMins;
        const splitTime = new Date(seg.endTime.getTime() - otMins * 60_000);
        ops.push(db.workSegment.update({
          where: { id: seg.id },
          data: { durationMinutes: regMins, endTime: splitTime },
        }));
        creates.push({
          timesheetId, segmentType: "WORK", startTime: splitTime, endTime: seg.endTime,
          durationMinutes: otMins, segmentDate: seg.segmentDate, isPaid: true,
          payBucket: "OT", isSplit: true, payCodeId: seg.payCodeId,
        });
        totalReclassified += otMins;
        remaining = 0;
      }
    }
  }

  if (totalReclassified === 0) return;

  await db.$transaction([
    ...ops,
    ...(creates.length > 0 ? [db.workSegment.createMany({ data: creates })] : []),
    db.overtimeBucket.upsert({
      where: { timesheetId_bucket: { timesheetId, bucket: "REG" } },
      create: { timesheetId, bucket: "REG", totalMinutes: 0 },
      update: { totalMinutes: { decrement: totalReclassified } },
    }),
    db.overtimeBucket.upsert({
      where: { timesheetId_bucket: { timesheetId, bucket: "OT" } },
      create: { timesheetId, bucket: "OT", totalMinutes: totalReclassified },
      update: { totalMinutes: { increment: totalReclassified } },
    }),
  ]);
}
