import { format } from "date-fns";
import { db } from "@/lib/db";
import { applyOvertime } from "@/lib/engines/overtime-engine";
import { startOfDayInTz, nextMidnightInTz } from "@/lib/utils/date";
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
export function computeSegments(
  timesheetId: string,
  punches: Punch[],
  timezone: string
): SegmentInput[] {
  const segments: SegmentInput[] = [];
  let openStart: Date | null = null;
  let openState: ActiveState | null = null;

  for (const punch of punches) {
    // Close the previous segment at this punch's rounded time
    if (openState && openStart) {
      segments.push(
        ...buildSegmentSpan(timesheetId, openStart, punch.roundedTime, openState, false, timezone)
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

    // If the employee already punched a real meal, no synthetic deduction needed
    const hasRealMeal = segments.some(
      (s) =>
        s.segmentType === "MEAL" &&
        format(s.segmentDate, "yyyy-MM-dd") === dayKey
    );
    if (hasRealMeal) continue;

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
  // Fetch the employee's site timezone so segment dates use the correct calendar day.
  const timesheet = await db.timesheet.findUniqueOrThrow({
    where: { id: timesheetId },
    select: {
      employee: {
        select: {
          tenantId: true,
          site: { select: { timezone: true } },
        },
      },
      payPeriod: { select: { startDate: true, endDate: true } },
    },
  });
  const timezone = timesheet.employee.site?.timezone ?? "UTC";
  const tenantId = timesheet.employee.tenantId;

  const punches = await db.punch.findMany({
    where: { timesheetId, isApproved: true, correctedById: null },
    orderBy: { roundedTime: "asc" },
  });

  const rawSegments = computeSegments(timesheetId, punches, timezone);

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
          payBucket: "REG",
          payCodeId: null,
        },
        data: { payCodeId: regularPayCode.id },
      });
    }
  }

  // Sync ABSENT exceptions for past days in the pay period with no activity.
  await syncAbsentExceptions(
    timesheetId,
    timezone,
    timesheet.payPeriod.startDate,
    timesheet.payPeriod.endDate,
    punches
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
  punches: Punch[]
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

  // Collect all past calendar days in the pay period that have no activity.
  const absentDays = new Set<string>();
  let dateStr = periodStartStr;
  while (dateStr < todayStr && dateStr <= periodEndStr) {
    if (!punchedDays.has(dateStr) && !leaveDays.has(dateStr)) {
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
  while (dateStr < todayStr && dateStr <= periodEndStr) {
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

      // End-of-day marker: 23:59:59 UTC (safely after any real punch on a past day)
      const eodTime = new Date(ds + "T23:59:59.000Z");

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
