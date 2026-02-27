import { format, startOfWeek } from "date-fns";
import { db } from "@/lib/db";
import type { WorkSegment, RuleSet, PayBucket } from "@prisma/client";
import type { DayBreakdown, OvertimeResult } from "@/types/overtime";

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

// ─── Pure calculation ─────────────────────────────────────────────────────────

/**
 * Find dates that are the Nth+ consecutive working day (where N = threshold).
 * Returns a Set of "yyyy-MM-dd" strings.
 */
function findConsecutiveOtDates(
  workDates: string[],
  threshold: number
): Set<string> {
  if (threshold <= 0) return new Set();

  const sorted = [...new Set(workDates)].sort();
  const otDates = new Set<string>();
  let streak = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const dayGap =
      (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (dayGap === 1) {
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
  const { dailyOtMinutes, dailyDtMinutes } = ruleSet;

  // DT threshold is the same regardless of consecutive-day status.
  const dtMinutes = Math.max(0, workMinutes - dailyDtMinutes);
  const belowDt = workMinutes - dtMinutes; // min(workMinutes, dailyDtMinutes)

  if (isConsecutiveOtDay) {
    // On the Nth consecutive day, the first dailyOtMinutes are OT (not REG).
    const otMinutes = belowDt;
    return { regMinutes: 0, otMinutes, dtMinutes };
  }

  const otMinutes = Math.max(0, belowDt - dailyOtMinutes);
  const regMinutes = belowDt - otMinutes;
  return { regMinutes, otMinutes, dtMinutes };
}

/**
 * Pure function: given WORK segments for one timesheet, compute OT breakdown.
 * Does NOT touch the database.
 */
export function computeOvertime(
  segments: WorkSegment[],
  ruleSet: RuleSet
): OvertimeResult {
  // Group work minutes by date
  const minutesByDate = new Map<string, number>();
  for (const seg of segments) {
    if (seg.segmentType !== "WORK") continue;
    const key = format(seg.segmentDate, "yyyy-MM-dd");
    minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + seg.durationMinutes);
  }

  const workDates = [...minutesByDate.keys()];
  const consecutiveOtDates = findConsecutiveOtDates(
    workDates,
    ruleSet.consecutiveDayOtDay
  );

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

  // Weekly OT: per calendar week (Mon–Sun), REG beyond the threshold → OT
  const weeksByKey = new Map<string, DayBreakdown[]>();
  for (const day of days) {
    const weekKey = format(
      startOfWeek(new Date(day.date), { weekStartsOn: 1 }),
      "yyyy-MM-dd"
    );
    const week = weeksByKey.get(weekKey) ?? [];
    week.push(day);
    weeksByKey.set(weekKey, week);
  }

  let weeklyOtConverted = 0;
  for (const weekDays of weeksByKey.values()) {
    const weekReg = weekDays.reduce((a, d) => a + d.regMinutes, 0);
    weeklyOtConverted += Math.max(0, weekReg - ruleSet.weeklyOtMinutes);
  }

  return {
    days,
    totalReg: totalRegFromDaily - weeklyOtConverted,
    totalOt: totalOtFromDaily + weeklyOtConverted,
    totalDt: totalDtFromDaily,
    weeklyOtConverted,
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
      const weekKey = format(
        startOfWeek(output[i].segmentDate, { weekStartsOn: 1 }),
        "yyyy-MM-dd"
      );
      const indices = weekGroups.get(weekKey) ?? [];
      indices.push(i);
      weekGroups.set(weekKey, indices);
    }

    // Also group DayBreakdowns by week to get per-week REG totals
    const weekRegTotals = new Map<string, number>();
    for (const day of result.days) {
      const weekKey = format(
        startOfWeek(new Date(day.date), { weekStartsOn: 1 }),
        "yyyy-MM-dd"
      );
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

  return output;
}

// ─── DB-aware wrapper ─────────────────────────────────────────────────────────

/**
 * Recalculate OvertimeBuckets for a timesheet and reclassify WORK segment
 * payBuckets (splitting at daily OT/DT thresholds and applying weekly OT).
 * Call this after rebuildSegments().
 */
export async function applyOvertime(
  timesheetId: string,
  ruleSet: RuleSet
): Promise<OvertimeResult> {
  const segments = await db.workSegment.findMany({
    where: { timesheetId },
  });

  const result = computeOvertime(segments, ruleSet);
  const reclassified = reclassifySegments(segments, result, ruleSet);

  await db.$transaction([
    // Delete existing WORK segments (MEAL/BREAK segments are untouched)
    db.workSegment.deleteMany({ where: { timesheetId, segmentType: "WORK" } }),
    // Recreate with correct payBuckets
    ...(reclassified.length > 0
      ? [db.workSegment.createMany({ data: reclassified })]
      : []),
    // Upsert aggregate OT buckets (preserve leave-type buckets)
    db.overtimeBucket.deleteMany({
      where: { timesheetId, bucket: { in: ["REG", "OT", "DT"] } },
    }),
    db.overtimeBucket.createMany({
      data: [
        { timesheetId, bucket: "REG", totalMinutes: result.totalReg },
        { timesheetId, bucket: "OT", totalMinutes: result.totalOt },
        { timesheetId, bucket: "DT", totalMinutes: result.totalDt },
      ],
    }),
  ]);

  return result;
}
