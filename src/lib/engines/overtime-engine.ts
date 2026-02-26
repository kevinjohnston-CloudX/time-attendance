import { format } from "date-fns";
import { db } from "@/lib/db";
import type { WorkSegment, RuleSet } from "@prisma/client";
import type { DayBreakdown, OvertimeResult } from "@/types/overtime";

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

  // Weekly OT: REG hours beyond the weekly threshold become OT
  const weeklyOtConverted = Math.max(
    0,
    totalRegFromDaily - ruleSet.weeklyOtMinutes
  );

  return {
    days,
    totalReg: totalRegFromDaily - weeklyOtConverted,
    totalOt: totalOtFromDaily + weeklyOtConverted,
    totalDt: totalDtFromDaily,
    weeklyOtConverted,
  };
}

// ─── DB-aware wrapper ─────────────────────────────────────────────────────────

/**
 * Recalculate OvertimeBuckets for a timesheet.
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

  // Upsert REG, OT, DT buckets (delete others so stale data doesn't linger)
  await db.$transaction([
    db.overtimeBucket.deleteMany({ where: { timesheetId } }),
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
