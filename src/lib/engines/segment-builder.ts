import { startOfDay, addDays } from "date-fns";
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

  const segments = computeSegments(timesheetId, punches);

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
