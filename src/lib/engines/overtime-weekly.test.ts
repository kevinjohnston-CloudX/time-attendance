// The engine reads calendar days in the process time zone; production runs in UTC.
process.env.TZ = "UTC";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { computeOvertime, reclassifySegments } from "./overtime-engine";

// NJ Hourly - No Rounding (w40): overtime past 40 hours a week, weeks from Sunday.
const ruleSet = {
  dailyOtMinutes: 1440, dailyDtMinutes: 1440, dailyDtMaxMinutes: 0,
  weeklyOtEnabled: true, weeklyOtMinutes: 2400, weeklyDtMinutes: 3600, weeklyDtMaxMinutes: 0,
  consecutiveDayOtEnabled: false, consecutiveDayOtDay: 7, consecutiveDayPayCycleOnly: true,
  consecutiveDayOtMaxMinutes: 0, consecutiveDayDtMaxMinutes: 0,
  weekStartDay: 0, otCycle: "WEEKLY", otCycleDays: null, otCycleAnchorDate: null,
  otGraceBeforeShiftMinutes: 0, otGraceAfterShiftMinutes: 0,
  payFrequency: "BIWEEKLY", payPeriodAnchorDate: null,
} as never;

/** One work line from 9:00 that day, the given minutes long. */
const work = (day: string, minutes: number) => {
  const start = new Date(`${day}T13:00:00Z`);
  return {
    id: day, timesheetId: "t", segmentType: "WORK", startTime: start, endTime: new Date(start.getTime() + minutes * 60_000),
    durationMinutes: minutes, segmentDate: new Date(`${day}T00:00:00Z`), isPaid: true, payBucket: "REG", payBucketOverride: null,
    isSplit: false, payCodeId: null, leaveRequestId: null,
  };
};

/** Paulett Laje's pay period, 9/27 to 10/10. */
const segments = [
  work("2026-09-28", 559), work("2026-09-29", 570), work("2026-09-30", 491), work("2026-10-01", 388), work("2026-10-02", 490),
  work("2026-10-05", 515), work("2026-10-06", 522), work("2026-10-07", 499), work("2026-10-08", 507), work("2026-10-09", 490),
] as never[];

const otByDay = () => {
  const out = reclassifySegments(segments as never, computeOvertime(segments as never, ruleSet), ruleSet);
  const by: Record<string, number> = {};
  for (const s of out) if (s.payBucket === "OT") by[s.segmentDate.toISOString().slice(0, 10)] = (by[s.segmentDate.toISOString().slice(0, 10)] ?? 0) + s.durationMinutes;
  return by;
};

describe("Weekly overtime", () => {
  it("lands on the day each week passes 40 hours, in both weeks of a period", () => {
    // Week 1 passes 40 on Friday 10/2 (98 minutes over); week 2 on Friday 10/9 (133 over),
    // not Thursday 10/8, where week 1's split used to push it.
    expect(otByDay()).toEqual({ "2026-10-02": 98, "2026-10-09": 133 });
  });
});
