import { startOfDay, addDays, format } from "date-fns";
import { db } from "@/lib/db";
import { applyOvertime } from "@/lib/engines/overtime-engine";
import type { Punch, RuleSet, PayBucket, SegmentType } from "@prisma/client";

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
 * Build one or more SegmentInputs from a time range, splitting at every midnight.
 * Recursive — handles shifts crossing multiple midnights.
 */
function buildSegmentSpan(
  timesheetId: string,
  start: Date,
  end: Date,
  state: ActiveState,
  isSplit: boolean
): SegmentInput[] {
  const nextMidnight = addDays(startOfDay(start), 1);

  if (end <= nextMidnight) {
    const durationMinutes = Math.round(
      (end.getTime() - start.getTime()) / 60_000
    );
    if (durationMinutes <= 0) return [];
    return [
      {
        timesheetId,
        segmentType: state as SegmentType,
        startTime: start,
        endTime: end,
        durationMinutes,
        segmentDate: startOfDay(start),
        isPaid: isPaidSegment(state),
        payBucket: payBucketFor(state),
        isSplit,
      },
    ];
  }

  // Crosses midnight — split and recurse
  return [
    ...buildSegmentSpan(timesheetId, start, nextMidnight, state, true),
    ...buildSegmentSpan(timesheetId, nextMidnight, end, state, true),
  ];
}

/**
 * Pure function: given an ordered list of approved punches,
 * returns the set of WorkSegment rows to insert.
 */
export function computeSegments(
  timesheetId: string,
  punches: Punch[]
): SegmentInput[] {
  const segments: SegmentInput[] = [];
  let openStart: Date | null = null;
  let openState: ActiveState | null = null;

  for (const punch of punches) {
    // Close the previous segment at this punch's rounded time
    if (openState && openStart) {
      segments.push(
        ...buildSegmentSpan(timesheetId, openStart, punch.roundedTime, openState, false)
      );
      openStart = null;
      openState = null;
    }

    // Open a new segment if entering an active state
    if (punch.stateAfter !== "OUT") {
      openStart = punch.roundedTime;
      openState = punch.stateAfter as ActiveState;
    }
  }

  // If the employee is still clocked in (openState != null), leave no dangling segment.
  // An in-progress shift will be captured on the next punch.

  return segments;
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
  ruleSet: RuleSet,
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

    const totalWork = workSegs.reduce((s, seg) => s + seg.durationMinutes, 0);
    if (totalWork <= ruleSet.mealBreakAfterMinutes) continue;

    // Sort by start time
    const sorted = [...workSegs].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    // Find the segment that contains the meal start point
    const mealStartMs =
      sorted[0].startTime.getTime() + ruleSet.mealBreakAfterMinutes * 60_000;
    const mealEndMs = mealStartMs + ruleSet.mealBreakMinutes * 60_000;

    const target = sorted.find(
      (seg) =>
        seg.startTime.getTime() <= mealStartMs &&
        seg.endTime.getTime() > mealStartMs
    );
    if (!target) continue; // Meal point falls in a gap — skip deduction

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
    const mealMins = ruleSet.mealBreakMinutes;
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
    ...segments.filter((s) => !toRemove.has(s)),
    ...toAdd,
    ...extra,
  ];
}

/**
 * Full rebuild: deletes all existing WorkSegments for a timesheet,
 * recomputes from approved punches, inserts new segments, then runs
 * the overtime engine to reclassify REG → OT / DT buckets.
 *
 * Call this after any punch change (create, approve, correct).
 */
export async function rebuildSegments(
  timesheetId: string,
  ruleSet: RuleSet
): Promise<void> {
  const punches = await db.punch.findMany({
    where: { timesheetId, isApproved: true, correctedById: null },
    orderBy: { roundedTime: "asc" },
  });

  const rawSegments = computeSegments(timesheetId, punches);

  let segments = rawSegments;
  if (ruleSet.autoDeductMeal) {
    const waivers = await db.mealWaiver.findMany({ where: { timesheetId } });
    const waivedDates = new Set(
      waivers.map((w) => format(w.segmentDate, "yyyy-MM-dd"))
    );
    segments = applyAutoMealDeduction(rawSegments, ruleSet, waivedDates);
  }

  // Rebuild segments in a transaction, then apply OT engine separately
  // (applyOvertime needs the newly inserted segments to be readable).
  await db.$transaction([
    db.workSegment.deleteMany({
      where: { timesheetId, segmentType: { in: ["WORK", "MEAL", "BREAK"] } },
    }),
    ...(segments.length > 0
      ? [db.workSegment.createMany({ data: segments })]
      : []),
  ]);

  // OT engine reads the fresh segments and writes REG/OT/DT buckets.
  await applyOvertime(timesheetId, ruleSet);
}
