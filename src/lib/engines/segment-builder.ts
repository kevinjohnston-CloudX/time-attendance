import { format, eachDayOfInterval, isWeekend } from "date-fns";
import { db } from "@/lib/db";
import { applyOvertime } from "@/lib/engines/overtime-engine";
import { startOfDayInTz, nextMidnightInTz } from "@/lib/utils/date";
import type { Punch, RuleSet, PayBucket, SegmentType, HolidayCreditMethod } from "@prisma/client";

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
/**
 * For salary employees: inserts an 8 h REG WorkSegment for every weekday in the
 * pay period (up to and including today) that has no existing WORK segment.
 * Called inside rebuildSegments so credits survive any punch-triggered rebuild.
 */
async function ensureSalarySegments(
  timesheetId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<void> {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  const rangeEnd = periodEnd < today ? periodEnd : today;

  const workDays = eachDayOfInterval({ start: periodStart, end: rangeEnd }).filter(
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

  const toCreate: SegmentInput[] = workDays
    .filter((d) => !coveredDates.has(format(d, "yyyy-MM-dd")))
    .map((d) => {
      const start = new Date(d);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setUTCHours(8, 0, 0, 0);
      return {
        timesheetId,
        segmentType: "WORK" as SegmentType,
        startTime: start,
        endTime: end,
        durationMinutes: SALARY_DAILY_MINUTES,
        segmentDate: start,
        isPaid: true,
        payBucket: "REG" as PayBucket,
        isSplit: false,
      };
    });

  if (toCreate.length > 0) {
    await db.workSegment.createMany({ data: toCreate });
  }
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
          tenantId: true,
          payType: true,
          site: { select: { timezone: true } },
          shift: {
            select: {
              startTime: true,
              endTime: true,
              workDays: true,
              lateInMinutes: true,
              earlyOutMinutes: true,
            },
          },
          holidayRule: {
            select: {
              creditMethod: true,
              creditMinutes: true,
              maxCreditMinutes: true,
              payBucket: true,
              workingPremium: true,
              requireDayBefore: true,
              requireDayAfter: true,
              minPeriodMinutes: true,
              countTowardOt: true,
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
      where: { timesheetId, segmentType: { in: ["WORK", "MEAL", "BREAK", "HOLIDAY"] } },
    }),
    ...(segments.length > 0
      ? [db.workSegment.createMany({ data: segments })]
      : []),
  ]);

  // For salary employees, fill in 8 h REG for any weekday with no real punch segments.
  if (isSalary) {
    await ensureSalarySegments(
      timesheetId,
      timesheet.payPeriod.startDate,
      timesheet.payPeriod.endDate
    );
  }

  // OT engine reads the fresh segments and writes REG/OT/DT buckets.
  await applyOvertime(timesheetId, ruleSet);

  // Holiday credits: delete any stale HOLIDAY bucket, then recompute from rule.
  await db.overtimeBucket.deleteMany({ where: { timesheetId, bucket: "HOLIDAY" } });
  if (timesheet.employee.holidayRule && tenantId) {
    await syncHolidayCredits(
      timesheetId,
      timezone,
      timesheet.payPeriod.startDate,
      timesheet.payPeriod.endDate,
      punches,
      timesheet.employee.holidayRule,
      tenantId,
      timesheet.employee.shift ?? null
    );
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

  // Sync LATE_IN / EARLY_OUT exceptions when the employee has a shift with tolerance configured.
  if (timesheet.employee.shift) {
    await syncPunchToleranceExceptions(
      timesheetId,
      timezone,
      timesheet.payPeriod.startDate,
      timesheet.payPeriod.endDate,
      punches,
      timesheet.employee.shift
    );
  }
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

  // Build set of days that have a WORK segment (covers salary auto-credits).
  const workSegs = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "WORK" },
    select: { segmentDate: true },
  });
  const workDays = new Set(workSegs.map((s) => format(s.segmentDate, "yyyy-MM-dd")));

  // Collect all past calendar days in the pay period that have no activity.
  const absentDays = new Set<string>();
  let dateStr = periodStartStr;
  while (dateStr < todayStr && dateStr <= periodEndStr) {
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

/**
 * Creates LATE_IN exceptions when the first clock-in of a shift day is more than
 * lateInMinutes after the shift start, and EARLY_OUT exceptions when the last
 * clock-out is more than earlyOutMinutes before the shift end.
 * Only fires for days matching the shift's workDays. 0 = feature disabled for that field.
 * Auto-resolves when punches are corrected to fall within tolerance.
 */
async function syncPunchToleranceExceptions(
  timesheetId: string,
  timezone: string,
  payPeriodStart: Date,
  payPeriodEnd: Date,
  punches: Punch[],
  shift: {
    startTime: string;
    endTime: string;
    workDays: number[];
    lateInMinutes: number;
    earlyOutMinutes: number;
  }
): Promise<void> {
  if (punches.length === 0) return;
  if (shift.lateInMinutes === 0 && shift.earlyOutMinutes === 0) return;

  const periodStartStr = format(payPeriodStart, "yyyy-MM-dd");
  const periodEndStr = format(payPeriodEnd, "yyyy-MM-dd");
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const localDateOf = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);

  const [shiftStartH, shiftStartM] = shift.startTime.split(":").map(Number);
  const [shiftEndH, shiftEndM] = shift.endTime.split(":").map(Number);
  const shiftStartMins = shiftStartH * 60 + shiftStartM;
  const shiftEndMins = shiftEndH * 60 + shiftEndM;

  const toLocalMins = (d: Date): number => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  };

  // Group punches by local date, sorted ascending
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

  const lateInDays = new Map<string, number>();   // dateStr → minutes late
  const earlyOutDays = new Map<string, number>(); // dateStr → minutes early

  let dateStr = periodStartStr;
  while (dateStr < todayStr && dateStr <= periodEndStr) {
    const dayPunches = punchesByDay.get(dateStr);
    if (dayPunches && dayPunches.length > 0) {
      const dow = new Date(dateStr + "T12:00:00.000Z").getUTCDay();
      if (shift.workDays.includes(dow)) {
        if (shift.lateInMinutes > 0) {
          const firstIn = dayPunches.find((p) => p.stateBefore === "OUT");
          if (firstIn) {
            const minsLate = toLocalMins(firstIn.roundedTime) - shiftStartMins;
            if (minsLate > shift.lateInMinutes) {
              lateInDays.set(dateStr, minsLate);
            }
          }
        }
        if (shift.earlyOutMinutes > 0) {
          const lastOut = [...dayPunches].reverse().find((p) => p.stateAfter === "OUT");
          if (lastOut) {
            const minsEarly = shiftEndMins - toLocalMins(lastOut.roundedTime);
            if (minsEarly > shift.earlyOutMinutes) {
              earlyOutDays.set(dateStr, minsEarly);
            }
          }
        }
      }
    }
    const d = new Date(dateStr + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + 1);
    dateStr = d.toISOString().slice(0, 10);
  }

  const formatDay = (ds: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "long", day: "numeric", year: "numeric", timeZone: timezone,
    }).format(new Date(ds + "T12:00:00.000Z"));

  // Sync LATE_IN
  const openLateIn = await db.exception.findMany({
    where: { timesheetId, exceptionType: "LATE_IN", resolvedAt: null },
    select: { id: true, occurredAt: true },
  });
  const openLateInByDate = new Map<string, string>(
    openLateIn.map((e) => [format(e.occurredAt, "yyyy-MM-dd"), e.id])
  );
  for (const [ds, mins] of lateInDays) {
    if (!openLateInByDate.has(ds)) {
      await db.exception.create({
        data: {
          timesheetId,
          exceptionType: "LATE_IN",
          description: `Clocked in ${mins} minute${mins !== 1 ? "s" : ""} late on ${formatDay(ds)}`,
          occurredAt: new Date(ds + "T12:00:00.000Z"),
        },
      });
    }
  }
  for (const [ds, exId] of openLateInByDate) {
    if (!lateInDays.has(ds)) {
      await db.exception.update({
        where: { id: exId },
        data: { resolvedAt: new Date(), resolution: "Auto-resolved: punch-in within tolerance" },
      });
    }
  }

  // Sync EARLY_OUT
  const openEarlyOut = await db.exception.findMany({
    where: { timesheetId, exceptionType: "EARLY_OUT", resolvedAt: null },
    select: { id: true, occurredAt: true },
  });
  const openEarlyOutByDate = new Map<string, string>(
    openEarlyOut.map((e) => [format(e.occurredAt, "yyyy-MM-dd"), e.id])
  );
  for (const [ds, mins] of earlyOutDays) {
    if (!openEarlyOutByDate.has(ds)) {
      await db.exception.create({
        data: {
          timesheetId,
          exceptionType: "EARLY_OUT",
          description: `Clocked out ${mins} minute${mins !== 1 ? "s" : ""} early on ${formatDay(ds)}`,
          occurredAt: new Date(ds + "T12:00:00.000Z"),
        },
      });
    }
  }
  for (const [ds, exId] of openEarlyOutByDate) {
    if (!earlyOutDays.has(ds)) {
      await db.exception.update({
        where: { id: exId },
        data: { resolvedAt: new Date(), resolution: "Auto-resolved: punch-out within tolerance" },
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
 *
 * NOTE: countTowardOt = true is not yet implemented. Holiday credits currently never
 * contribute to the weekly OT accumulator regardless of this flag.
 */
async function syncHolidayCredits(
  timesheetId: string,
  timezone: string,
  payPeriodStart: Date,
  payPeriodEnd: Date,
  punches: Punch[],
  rule: {
    creditMethod: HolidayCreditMethod;
    creditMinutes: number;
    maxCreditMinutes: number;
    payBucket: PayBucket;
    workingPremium: number;
    requireDayBefore: boolean;
    requireDayAfter: boolean;
    minPeriodMinutes: number;
    countTowardOt: boolean;
  },
  tenantId: string,
  shift: { startTime: string; endTime: string; workDays: number[] } | null
): Promise<void> {
  const holidays = await db.holiday.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [
        { date:         { gte: payPeriodStart, lte: payPeriodEnd } },
        { observedDate: { gte: payPeriodStart, lte: payPeriodEnd } },
      ],
    },
    select: { date: true, observedDate: true },
  });
  if (holidays.length === 0) return;

  const periodStartStr = format(payPeriodStart, "yyyy-MM-dd");
  const periodEndStr   = format(payPeriodEnd,   "yyyy-MM-dd");
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const localDateOf = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);

  // Effective holiday dates — use observedDate when set
  const holidayDates = new Set<string>(
    holidays.map((h) => format(h.observedDate ?? h.date, "yyyy-MM-dd"))
  );

  // Paid WORK segments already written by the OT engine
  const workSegs = await db.workSegment.findMany({
    where: { timesheetId, segmentType: "WORK", isPaid: true },
    select: { segmentDate: true, durationMinutes: true },
  });
  const workedMinsByDay = new Map<string, number>();
  for (const seg of workSegs) {
    const ds = format(seg.segmentDate, "yyyy-MM-dd");
    workedMinsByDay.set(ds, (workedMinsByDay.get(ds) ?? 0) + seg.durationMinutes);
  }

  // Minimum period check
  const totalWorkedMins = [...workedMinsByDay.values()].reduce((a, b) => a + b, 0);
  if (rule.minPeriodMinutes > 0 && totalWorkedMins < rule.minPeriodMinutes) return;

  // Days with any activity (for requireDayBefore/After checks)
  const punchedDays = new Set(punches.map((p) => localDateOf(p.roundedTime)));
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

  // Walk to the nearest adjacent scheduled work day (skips holidays and non-work days)
  function adjacentWorkDay(fromDs: string, dir: 1 | -1): string {
    const d = new Date(fromDs + "T12:00:00.000Z");
    for (let i = 0; i < 14; i++) {
      d.setUTCDate(d.getUTCDate() + dir);
      const ds = d.toISOString().slice(0, 10);
      const dow = new Date(ds + "T12:00:00.000Z").getUTCDay();
      const onSchedule = !shift || shift.workDays.includes(dow);
      if (onSchedule && !holidayDates.has(ds)) return ds;
    }
    return "";
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
  };

  const toCreate: HolidaySegInput[] = [];

  for (const ds of holidayDates) {
    if (ds < periodStartStr || ds > periodEndStr) continue;
    if (ds >= todayStr) continue;

    // Eligibility: must have worked the day before
    if (rule.requireDayBefore) {
      const prev = adjacentWorkDay(ds, -1);
      if (!prev || !activityDays.has(prev)) continue;
    }

    // Eligibility: must have worked the day after (only once that day has passed)
    if (rule.requireDayAfter) {
      const next = adjacentWorkDay(ds, 1);
      if (!next || next >= todayStr) continue;
      if (!activityDays.has(next)) continue;
    }

    // Credit amount
    let creditMins: number;
    if (rule.creditMethod === "ACTUAL_WORKED") {
      creditMins = workedMinsByDay.get(ds) ?? 0;
    } else if (rule.creditMethod === "SCHEDULED_HOURS") {
      creditMins = shiftDurationMins;
    } else {
      creditMins = rule.creditMinutes;
    }
    if (rule.maxCreditMinutes > 0) creditMins = Math.min(creditMins, rule.maxCreditMinutes);
    if (creditMins <= 0) continue;

    const segmentDate = new Date(ds + "T00:00:00.000Z");
    const creditStart = new Date(ds + "T00:00:00.000Z");

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
    });

    // Working premium — extra pay for hours actually clocked on the holiday
    const workedMins = workedMinsByDay.get(ds) ?? 0;
    if (workedMins > 0 && rule.workingPremium > 100) {
      const premiumMins = Math.round(workedMins * (rule.workingPremium - 100) / 100);
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
        });
      }
    }
  }

  if (toCreate.length === 0) return;

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
