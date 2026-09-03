import { format, startOfWeek } from "date-fns";
import { db } from "@/lib/db";
import type { WorkSegment, RuleSet, PayBucket } from "@prisma/client";
import type { DayBreakdown, OvertimeResult } from "@/types/overtime";
import { snapToLocalTime } from "@/lib/utils/date";

interface ReclassifiedSegment {
  timesheetId: string;
  segmentType: "WORK";
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  segmentDate: Date;
  isPaid: boolean;
  payBucket: PayBucket;
  isSplit: boolean;
}

// ─── OT window key ───────────────────────────────────────────────────────────

/**
 * Returns a string key identifying which OT accumulation window a date falls in.
 * WEEKLY: standard calendar week anchored to ruleSet.weekStartDay.
 * BIWEEKLY / CUSTOM: fixed-length windows tiled forward from otCycleAnchorDate.
 */
function getOtWindowKey(date: Date | string, ruleSet: RuleSet): string {
  const d = typeof date === "string" ? new Date(date + "T12:00:00Z") : date;
  const cycle = ruleSet.otCycle ?? "WEEKLY";

  if (cycle === "WEEKLY" || !ruleSet.otCycleAnchorDate) {
    return format(
      startOfWeek(d, { weekStartsOn: ruleSet.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }),
      "yyyy-MM-dd"
    );
  }

  const cycleDays = cycle === "BIWEEKLY" ? 14 : (ruleSet.otCycleDays ?? 14);
  const anchorMs = new Date(ruleSet.otCycleAnchorDate).setHours(12, 0, 0, 0);
  const daysSinceAnchor = Math.round((d.getTime() - anchorMs) / 86_400_000);
  return `ot-window-${Math.floor(daysSinceAnchor / cycleDays)}`;
}

// ─── Pay period key ───────────────────────────────────────────────────────────

/**
 * Returns a string key identifying which pay period a date falls in,
 * using the rule set's payFrequency and payPeriodAnchorDate.
 * Used to enforce consecutiveDayPayCycleOnly boundaries.
 */
function getPayPeriodKey(date: Date | string, ruleSet: RuleSet): string {
  const d = typeof date === "string" ? new Date(date + "T12:00:00Z") : date;
  const freq = ruleSet.payFrequency ?? "BIWEEKLY";

  if (freq === "WEEKLY") {
    return format(
      startOfWeek(d, { weekStartsOn: ruleSet.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }),
      "yyyy-MM-dd"
    );
  }

  if (freq === "BIWEEKLY" && ruleSet.payPeriodAnchorDate) {
    const anchorMs = new Date(ruleSet.payPeriodAnchorDate).setHours(12, 0, 0, 0);
    const daysSinceAnchor = Math.round((d.getTime() - anchorMs) / 86_400_000);
    return `pp-biweekly-${Math.floor(daysSinceAnchor / 14)}`;
  }

  if (freq === "SEMIMONTHLY") {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const half = d.getUTCDate() < 16 ? "A" : "B";
    return `pp-semi-${year}-${month}-${half}`;
  }

  // MONTHLY (or BIWEEKLY with no anchor — fall back to month)
  return `pp-monthly-${d.getUTCFullYear()}-${d.getUTCMonth()}`;
}

// ─── Pure calculation ─────────────────────────────────────────────────────────

/**
 * Find dates that are the Nth+ consecutive working day (where N = threshold).
 * The streak resets at workweek boundaries. When consecutiveDayPayCycleOnly is
 * true it also resets at pay period boundaries so all N days stay in one cycle.
 * Returns a Set of "yyyy-MM-dd" strings.
 */
function findConsecutiveOtDates(
  workDates: string[],
  ruleSet: RuleSet
): Set<string> {
  const threshold = ruleSet.consecutiveDayOtDay;
  if (threshold <= 0) return new Set();

  const weekStartsOn = ruleSet.weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  const sorted = [...new Set(workDates)].sort();
  const otDates = new Set<string>();
  let streak = 1;

  for (let i = 1; i < sorted.length; i++) {
    // Use noon UTC to avoid DST edge cases when computing day gaps.
    const prev = new Date(sorted[i - 1] + "T12:00:00Z");
    const curr = new Date(sorted[i] + "T12:00:00Z");
    const dayGap = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    const crossesWeekBoundary =
      startOfWeek(prev, { weekStartsOn }).getTime() !==
      startOfWeek(curr, { weekStartsOn }).getTime();

    const crossesPayPeriodBoundary =
      ruleSet.consecutiveDayPayCycleOnly &&
      getPayPeriodKey(prev, ruleSet) !== getPayPeriodKey(curr, ruleSet);

    if (dayGap === 1 && !crossesWeekBoundary && !crossesPayPeriodBoundary) {
      streak++;
    } else {
      streak = 1;
    }

    if (streak >= threshold) {
      otDates.add(sorted[i]);
    }
  }

  return otDates;
}

/**
 * Break a single day's work minutes into REG / OT / DT buckets.
 *
 * Normal day:
 *   0 – dailyOtMinutes     → REG
 *   dailyOtMinutes – dailyDtMinutes → OT
 *   dailyDtMinutes+        → DT
 *
 * Consecutive OT day (e.g. 7th consecutive day):
 *   0 – dailyOtMinutes     → OT  (no REG)
 *   dailyOtMinutes+        → DT
 */
function calcDayBuckets(
  workMinutes: number,
  ruleSet: RuleSet,
  isConsecutiveOtDay: boolean
): { regMinutes: number; otMinutes: number; dtMinutes: number } {
  const { dailyOtMinutes, dailyDtMinutes, dailyDtMaxMinutes } = ruleSet;
  const capDt = (raw: number) =>
    dailyDtMaxMinutes > 0 ? Math.min(raw, dailyDtMaxMinutes) : raw;

  if (isConsecutiveOtDay) {
    let dtMinutes = capDt(Math.max(0, workMinutes - dailyOtMinutes));
    if (ruleSet.consecutiveDayDtMaxMinutes > 0) dtMinutes = Math.min(dtMinutes, ruleSet.consecutiveDayDtMaxMinutes);
    let otMinutes = workMinutes - dtMinutes;
    if (ruleSet.consecutiveDayOtMaxMinutes > 0) otMinutes = Math.min(otMinutes, ruleSet.consecutiveDayOtMaxMinutes);
    return { regMinutes: 0, otMinutes, dtMinutes };
  }

  const dtMinutes = capDt(Math.max(0, workMinutes - dailyDtMinutes));
  const belowDt = workMinutes - dtMinutes;
  const otMinutes = Math.max(0, belowDt - dailyOtMinutes);
  const regMinutes = belowDt - otMinutes;
  return { regMinutes, otMinutes, dtMinutes };
}

/**
 * Pure function: given WORK segments for one timesheet, compute OT breakdown.
 * Does NOT touch the database.
 *
 * When `shift` and `timezone` are provided, the grace period is applied
 * per-punch: minutes clocked before shift start (within otGraceBeforeShiftMinutes)
 * and after shift end (within otGraceAfterShiftMinutes) are reclassified back to REG.
 */
export function computeOvertime(
  segments: WorkSegment[],
  ruleSet: RuleSet,
  shift?: { startTime: string; endTime: string } | null,
  timezone?: string
): OvertimeResult {
  // Group work minutes by date
  const minutesByDate = new Map<string, number>();
  for (const seg of segments) {
    if (seg.segmentType !== "WORK") continue;
    const key = format(seg.segmentDate, "yyyy-MM-dd");
    minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + seg.durationMinutes);
  }

  const workDates = [...minutesByDate.keys()];
  const consecutiveOtDates = ruleSet.consecutiveDayOtEnabled
    ? findConsecutiveOtDates(workDates, ruleSet)
    : new Set<string>();

  // Per-day breakdown
  const days: DayBreakdown[] = workDates.sort().map((date) => {
    const workMinutes = minutesByDate.get(date) ?? 0;
    const isConsecutiveOtDay = consecutiveOtDates.has(date);
    const { regMinutes, otMinutes, dtMinutes } = calcDayBuckets(
      workMinutes,
      ruleSet,
      isConsecutiveOtDay
    );
    return { date, workMinutes, regMinutes, otMinutes, dtMinutes, isConsecutiveOtDay };
  });

  // Totals from daily buckets
  const totalDtFromDaily = days.reduce((a, d) => a + d.dtMinutes, 0);
  const totalOtFromDaily = days.reduce((a, d) => a + d.otMinutes, 0);
  const totalRegFromDaily = days.reduce((a, d) => a + d.regMinutes, 0);

  // OT cycle grouping
  const windowsByKey = new Map<string, DayBreakdown[]>();
  for (const day of days) {
    const key = getOtWindowKey(day.date, ruleSet);
    const w = windowsByKey.get(key) ?? [];
    w.push(day);
    windowsByKey.set(key, w);
  }

  // Weekly OT: REG above weeklyOtMinutes per window → OT
  let weeklyOtConverted = 0;
  if (ruleSet.weeklyOtEnabled) {
    for (const windowDays of windowsByKey.values()) {
      const windowReg = windowDays.reduce((a, d) => a + d.regMinutes, 0);
      weeklyOtConverted += Math.max(0, windowReg - ruleSet.weeklyOtMinutes);
    }
  }

  // Weekly DT: total work above weeklyDtMinutes per window → DT (minus already-daily-DT)
  let weeklyDtConverted = 0;
  if (ruleSet.weeklyDtMinutes < 86400) {
    for (const windowDays of windowsByKey.values()) {
      const windowTotal = windowDays.reduce((a, d) => a + d.workMinutes, 0);
      const windowDailyDt = windowDays.reduce((a, d) => a + d.dtMinutes, 0);
      const raw = Math.max(0, Math.max(0, windowTotal - ruleSet.weeklyDtMinutes) - windowDailyDt);
      weeklyDtConverted += ruleSet.weeklyDtMaxMinutes > 0 ? Math.min(raw, ruleSet.weeklyDtMaxMinutes) : raw;
    }
  }

  // Grace period: reclassify boundary minutes (before shift start / after shift end) from OT → REG.
  const graceBefore = ruleSet.otGraceBeforeShiftMinutes ?? 0;
  const graceAfter  = ruleSet.otGraceAfterShiftMinutes  ?? 0;
  if ((graceBefore > 0 || graceAfter > 0) && shift && timezone) {
    // Build per-day first/last work segment boundary (UTC timestamps)
    const dayFirstStart = new Map<string, Date>();
    const dayLastEnd    = new Map<string, Date>();
    for (const seg of segments) {
      if (seg.segmentType !== "WORK") continue;
      const ds = format(seg.segmentDate, "yyyy-MM-dd");
      if (!dayFirstStart.has(ds) || seg.startTime < dayFirstStart.get(ds)!) {
        dayFirstStart.set(ds, seg.startTime);
      }
      if (!dayLastEnd.has(ds) || seg.endTime > dayLastEnd.get(ds)!) {
        dayLastEnd.set(ds, seg.endTime);
      }
    }

    for (const day of days) {
      if (day.otMinutes <= 0) continue;

      const firstStart = dayFirstStart.get(day.date);
      const lastEnd    = dayLastEnd.get(day.date);
      if (!firstStart && !lastEnd) continue;

      const shiftStartUtc = snapToLocalTime(shift.startTime, day.date, timezone);
      let   shiftEndUtc   = snapToLocalTime(shift.endTime,   day.date, timezone);
      // Handle overnight shifts
      if (shiftEndUtc <= shiftStartUtc) shiftEndUtc = new Date(shiftEndUtc.getTime() + 86_400_000);

      let graceApplied = 0;

      // Minutes the employee started before the shift start (within grace window)
      if (graceBefore > 0 && firstStart && firstStart < shiftStartUtc) {
        const earlyMins = Math.round((shiftStartUtc.getTime() - firstStart.getTime()) / 60_000);
        graceApplied += Math.min(earlyMins, graceBefore);
      }

      // Minutes the employee stayed after the shift end (within grace window)
      if (graceAfter > 0 && lastEnd && lastEnd > shiftEndUtc) {
        const lateMins = Math.round((lastEnd.getTime() - shiftEndUtc.getTime()) / 60_000);
        graceApplied += Math.min(lateMins, graceAfter);
      }

      graceApplied = Math.min(graceApplied, day.otMinutes);
      if (graceApplied > 0) {
        day.otMinutes  -= graceApplied;
        day.regMinutes += graceApplied;
      }
    }
  } else if ((graceBefore > 0 || graceAfter > 0) && !shift) {
    // Fallback when no shift is assigned: treat the combined grace as a flat daily window
    const graceTotal = graceBefore + graceAfter;
    for (const day of days) {
      if (day.otMinutes > 0 && day.otMinutes <= graceTotal) {
        day.regMinutes += day.otMinutes;
        day.otMinutes = 0;
      }
    }
  }

  return {
    days,
    totalReg: totalRegFromDaily - weeklyOtConverted,
    totalOt: totalOtFromDaily + weeklyOtConverted - weeklyDtConverted,
    totalDt: totalDtFromDaily + weeklyDtConverted,
    weeklyOtConverted,
    weeklyDtConverted,
  };
}

// ─── Segment reclassification ─────────────────────────────────────────────────

/**
 * Split a single WORK segment at bucket thresholds (REG→OT, OT→DT).
 * `minutesBefore` is the cumulative work minutes already consumed
 * earlier in the day before this segment starts.
 */
function splitSegmentAtThresholds(
  seg: WorkSegment,
  minutesBefore: number,
  thresholds: { limit: number; bucket: PayBucket }[]
): ReclassifiedSegment[] {
  const parts: ReclassifiedSegment[] = [];
  let remaining = seg.durationMinutes;
  let currentTime = seg.startTime;
  let cursor = minutesBefore;

  for (const { limit, bucket } of thresholds) {
    if (remaining <= 0) break;
    if (cursor >= limit) continue;

    const minutesInBucket = Math.min(remaining, limit - cursor);
    const endTime = new Date(currentTime.getTime() + minutesInBucket * 60_000);

    parts.push({
      timesheetId: seg.timesheetId,
      segmentType: "WORK",
      startTime: currentTime,
      endTime,
      durationMinutes: minutesInBucket,
      segmentDate: seg.segmentDate,
      isPaid: true,
      payBucket: bucket,
      isSplit: seg.isSplit || minutesInBucket < seg.durationMinutes,
    });

    currentTime = endTime;
    cursor += minutesInBucket;
    remaining -= minutesInBucket;
  }

  return parts;
}

/**
 * Reclassify WORK segments with correct payBucket values based on
 * the computed daily OT breakdown, then apply weekly OT conversion.
 */
function reclassifySegments(
  segments: WorkSegment[],
  result: OvertimeResult,
  ruleSet: RuleSet
): ReclassifiedSegment[] {
  const output: ReclassifiedSegment[] = [];

  // Phase 1: Daily reclassification — split segments at REG→OT→DT thresholds
  for (const day of result.days) {
    const daySegments = segments
      .filter(
        (s) =>
          s.segmentType === "WORK" &&
          format(s.segmentDate, "yyyy-MM-dd") === day.date
      )
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    const regEnd = day.regMinutes;
    const otEnd = regEnd + day.otMinutes;

    let consumed = 0;
    for (const seg of daySegments) {
      const parts = splitSegmentAtThresholds(seg, consumed, [
        { limit: regEnd, bucket: "REG" },
        { limit: otEnd, bucket: "OT" },
        { limit: Infinity, bucket: "DT" },
      ]);
      output.push(...parts);
      consumed += seg.durationMinutes;
    }
  }

  // Phase 2: Weekly OT — per calendar week, convert last REG segments to OT
  if (result.weeklyOtConverted > 0) {
    // Group output indices by calendar week
    const weekGroups = new Map<string, number[]>();
    for (let i = 0; i < output.length; i++) {
      const weekKey = getOtWindowKey(output[i].segmentDate, ruleSet);
      const indices = weekGroups.get(weekKey) ?? [];
      indices.push(i);
      weekGroups.set(weekKey, indices);
    }

    // Also group DayBreakdowns by week to get per-week REG totals
    const weekRegTotals = new Map<string, number>();
    for (const day of result.days) {
      const weekKey = getOtWindowKey(day.date, ruleSet);
      weekRegTotals.set(
        weekKey,
        (weekRegTotals.get(weekKey) ?? 0) + day.regMinutes
      );
    }

    for (const [weekKey, indices] of weekGroups.entries()) {
      const weekReg = weekRegTotals.get(weekKey) ?? 0;
      let remaining = Math.max(0, weekReg - ruleSet.weeklyOtMinutes);
      if (remaining <= 0) continue;

      // Walk backwards through this week's segments
      for (let j = indices.length - 1; j >= 0 && remaining > 0; j--) {
        const i = indices[j];
        if (output[i].payBucket !== "REG") continue;

        if (output[i].durationMinutes <= remaining) {
          remaining -= output[i].durationMinutes;
          output[i].payBucket = "OT";
        } else {
          const otMinutes = remaining;
          const regMinutes = output[i].durationMinutes - otMinutes;
          const splitTime = new Date(
            output[i].startTime.getTime() + regMinutes * 60_000
          );

          const otPart: ReclassifiedSegment = {
            ...output[i],
            startTime: splitTime,
            durationMinutes: otMinutes,
            payBucket: "OT",
            isSplit: true,
          };

          output[i] = {
            ...output[i],
            endTime: splitTime,
            durationMinutes: regMinutes,
            isSplit: true,
          };

          output.splice(i + 1, 0, otPart);
          remaining = 0;
        }
      }
    }
  }

  // Phase 3: Weekly DT — convert trailing OT segments to DT per window
  if (result.weeklyDtConverted > 0) {
    const windowGroups = new Map<string, number[]>();
    for (let i = 0; i < output.length; i++) {
      const key = getOtWindowKey(output[i].segmentDate, ruleSet);
      const indices = windowGroups.get(key) ?? [];
      indices.push(i);
      windowGroups.set(key, indices);
    }

    const windowStats = new Map<string, { total: number; dailyDt: number }>();
    for (const day of result.days) {
      const key = getOtWindowKey(day.date, ruleSet);
      const prev = windowStats.get(key) ?? { total: 0, dailyDt: 0 };
      windowStats.set(key, { total: prev.total + day.workMinutes, dailyDt: prev.dailyDt + day.dtMinutes });
    }

    for (const [key, indices] of windowGroups.entries()) {
      const stats = windowStats.get(key);
      if (!stats) continue;
      const raw = Math.max(0, Math.max(0, stats.total - ruleSet.weeklyDtMinutes) - stats.dailyDt);
      let remaining = ruleSet.weeklyDtMaxMinutes > 0 ? Math.min(raw, ruleSet.weeklyDtMaxMinutes) : raw;
      if (remaining <= 0) continue;

      for (let j = indices.length - 1; j >= 0 && remaining > 0; j--) {
        const i = indices[j];
        if (output[i].payBucket !== "OT") continue;

        if (output[i].durationMinutes <= remaining) {
          remaining -= output[i].durationMinutes;
          output[i].payBucket = "DT";
        } else {
          const dtMinutes = remaining;
          const otMinutes = output[i].durationMinutes - dtMinutes;
          const splitTime = new Date(output[i].startTime.getTime() + otMinutes * 60_000);
          const dtPart: ReclassifiedSegment = { ...output[i], startTime: splitTime, durationMinutes: dtMinutes, payBucket: "DT", isSplit: true };
          output[i] = { ...output[i], endTime: splitTime, durationMinutes: otMinutes, isSplit: true };
          output.splice(i + 1, 0, dtPart);
          remaining = 0;
        }
      }
    }
  }

  return output;
}

// ─── DB-aware wrapper ─────────────────────────────────────────────────────────

/**
 * Recalculate OvertimeBuckets for a timesheet and reclassify WORK segment
 * payBuckets (splitting at daily OT/DT thresholds and applying weekly OT).
 * Call this after rebuildSegments().
 *
 * WORK segments whose originating CLOCK_IN punch carries a pay code with
 * countsTowardOt = false are excluded from the OT accumulator and remain REG.
 * Their minutes are added back into the REG bucket total so aggregate hours balance.
 */
export async function applyOvertime(
  timesheetId: string,
  ruleSet: RuleSet,
  shift?: { startTime: string; endTime: string } | null,
  timezone?: string
): Promise<OvertimeResult> {
  const [segments, punchesWithCode, missingPunchExceptions] = await Promise.all([
    db.workSegment.findMany({ where: { timesheetId } }),
    db.punch.findMany({
      where: { timesheetId, isApproved: true, correctedById: null, payCodeId: { not: null } },
      orderBy: { roundedTime: "asc" },
      select: { punchType: true, roundedTime: true, payCodeId: true },
    }),
    db.exception.findMany({
      where: { timesheetId, exceptionType: "MISSING_PUNCH", resolvedAt: null },
      select: { occurredAt: true },
    }),
  ]);

  // Dates with unresolved missing punches are excluded from OT accumulation.
  // Once the missing punch is added and the timesheet is recalculated they count normally.
  const missedPunchDates = new Set(
    missingPunchExceptions.map((e) => format(e.occurredAt, "yyyy-MM-dd"))
  );

  // Build exempt time ranges from punches whose pay code excludes OT counting
  const exemptRanges: Array<{ start: Date; end: Date | null }> = [];
  if (punchesWithCode.length > 0) {
    const uniqueIds = [...new Set(punchesWithCode.map((p) => p.payCodeId!))];
    const exemptCodes = await db.payCode.findMany({
      where: { id: { in: uniqueIds }, countsTowardOt: false },
      select: { id: true },
    });
    const exemptIdSet = new Set(exemptCodes.map((c) => c.id));
    if (exemptIdSet.size > 0) {
      for (let i = 0; i < punchesWithCode.length; i++) {
        const p = punchesWithCode[i];
        if (p.punchType !== "CLOCK_IN" || !p.payCodeId || !exemptIdSet.has(p.payCodeId)) continue;
        const clockOut = punchesWithCode.slice(i + 1).find((pp) => pp.punchType === "CLOCK_OUT") ?? null;
        exemptRanges.push({ start: p.roundedTime, end: clockOut?.roundedTime ?? null });
      }
    }
  }

  // Separate WORK segments that fall inside an exempt punch pair's window
  const isExemptSeg = exemptRanges.length === 0
    ? () => false
    : (seg: WorkSegment) => {
        for (const range of exemptRanges) {
          if (seg.startTime >= range.start && (range.end === null || seg.startTime < range.end)) return true;
        }
        return false;
      };

  const isMissedPunchSeg = (seg: WorkSegment) =>
    seg.segmentType === "WORK" && missedPunchDates.has(format(seg.segmentDate, "yyyy-MM-dd"));

  const workExempt = segments.filter((s) => s.segmentType === "WORK" && (isExemptSeg(s) || isMissedPunchSeg(s)));
  const otEligible = segments.filter((s) => s.segmentType !== "WORK" || (!isExemptSeg(s) && !isMissedPunchSeg(s)));

  const result = computeOvertime(otEligible, ruleSet, shift, timezone);
  const reclassified = reclassifySegments(otEligible, result, ruleSet);

  // Exempt segments stay as REG — preserve all fields except payBucket
  const exemptAsReg: ReclassifiedSegment[] = workExempt.map((seg) => ({
    timesheetId: seg.timesheetId,
    segmentType: "WORK" as const,
    startTime: seg.startTime,
    endTime: seg.endTime,
    durationMinutes: seg.durationMinutes,
    segmentDate: seg.segmentDate,
    isPaid: seg.isPaid,
    payBucket: "REG" as PayBucket,
    isSplit: seg.isSplit,
  }));

  const exemptMinutes = workExempt.reduce((s, seg) => s + seg.durationMinutes, 0);
  const allReclassified = [...reclassified, ...exemptAsReg];

  // When OT requires authorization and new OT exists, reset otAuthorized to false
  // so a supervisor must re-approve after any recalculation.
  const hasOt = result.totalOt > 0 || result.totalDt > 0;
  const requiresAuth = ruleSet.overtimeRequiresAuth && hasOt;

  await db.$transaction([
    db.workSegment.deleteMany({ where: { timesheetId, segmentType: "WORK" } }),
    ...(allReclassified.length > 0
      ? [db.workSegment.createMany({ data: allReclassified })]
      : []),
    db.overtimeBucket.deleteMany({
      where: { timesheetId, bucket: { in: ["REG", "OT", "DT"] } },
    }),
    db.overtimeBucket.createMany({
      data: [
        { timesheetId, bucket: "REG", totalMinutes: result.totalReg + exemptMinutes },
        { timesheetId, bucket: "OT", totalMinutes: result.totalOt },
        { timesheetId, bucket: "DT", totalMinutes: result.totalDt },
      ],
    }),
    ...(requiresAuth
      ? [db.timesheet.update({ where: { id: timesheetId }, data: { otAuthorized: false } })]
      : []),
  ]);

  return result;
}
