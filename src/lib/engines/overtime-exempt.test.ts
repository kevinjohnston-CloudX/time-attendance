// The engine reads calendar days in the process time zone; production runs in UTC.
process.env.TZ = "UTC";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, written } = vi.hoisted(() => {
  const written: { segments: { payBucket: string; durationMinutes: number; segmentDate: Date }[]; buckets: { bucket: string; totalMinutes: number }[] } = { segments: [], buckets: [] };
  return {
    written,
    db: {
      workSegment: {
        findMany: vi.fn(),
        deleteMany: vi.fn(() => "deleteSegments"),
        createMany: vi.fn(({ data }) => { written.segments = data; return "createSegments"; }),
      },
      punch: { findMany: vi.fn() },
      exception: { findMany: vi.fn(async (): Promise<{ occurredAt: Date }[]> => []) },
      payCode: { findMany: vi.fn() },
      overtimeBucket: {
        deleteMany: vi.fn(() => "deleteBuckets"),
        createMany: vi.fn(({ data }) => { written.buckets = data; return "createBuckets"; }),
      },
      timesheet: { update: vi.fn() },
      $transaction: vi.fn(async () => []),
    },
  };
});
vi.mock("@/lib/db", () => ({ db }));

import { applyOvertime, exemptBucket } from "./overtime-engine";

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

const work = (start: string, minutes: number, payCodeId: string | null = null) => {
  const s = new Date(start);
  return {
    id: start, timesheetId: "t", segmentType: "WORK", startTime: s, endTime: new Date(s.getTime() + minutes * 60_000),
    durationMinutes: minutes, segmentDate: new Date(`${start.slice(0, 10)}T00:00:00Z`), isPaid: true, payBucket: "REG",
    payBucketOverride: null, isSplit: false, payCodeId, leaveRequestId: null,
  };
};
const pair = (start: string, minutes: number, payCodeId: string | null = null) => {
  const s = new Date(start);
  return [
    { punchType: "CLOCK_IN", roundedTime: s, payCodeId },
    { punchType: "CLOCK_OUT", roundedTime: new Date(s.getTime() + minutes * 60_000), payCodeId: null },
  ];
};

/**
 * Manuel Reyes, week of 11/8: 8.5 hours of OT RETRO entered on Sunday, then
 * five days of 10 hours worked.
 */
function week(retroCode: string) {
  const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
  db.workSegment.findMany.mockResolvedValue([
    work("2026-11-08T05:00:00Z", 510, retroCode),
    ...days.map((d) => work(`${d}T13:00:00Z`, 600)),
  ]);
  db.punch.findMany.mockResolvedValue([
    ...pair("2026-11-08T05:00:00Z", 510, retroCode),
    ...days.flatMap((d) => pair(`${d}T13:00:00Z`, 600)),
  ]);
}

const sunday = () => written.segments.filter((s) => s.segmentDate.toISOString().startsWith("2026-11-08"));
const total = (bucket: string) => written.buckets.find((b) => b.bucket === bucket)?.totalMinutes;

beforeEach(() => {
  vi.clearAllMocks();
  written.segments = [];
  written.buckets = [];
  db.exception.findMany.mockResolvedValue([]);
  db.payCode.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    [
      { id: "otRetro", payBucket: "OT" },
      { id: "dtRetro", payBucket: "DT" },
      { id: "regNoOt", payBucket: "REG" },
    ].filter((c) => where.id.in.includes(c.id)),
  );
});

describe("Hours under a code that does not count toward overtime", () => {
  it("are overtime when the code is an overtime code, and still left out of the week's 40", async () => {
    week("otRetro");
    await applyOvertime("t", ruleSet);
    expect(sunday()).toEqual([expect.objectContaining({ payBucket: "OT", durationMinutes: 510 })]);
    // 50 hours worked: 40 regular, 10 overtime, plus the 8.5 retro.
    expect(total("REG")).toBe(2400);
    expect(total("OT")).toBe(600 + 510);
  });

  it("are double time under a double time code", async () => {
    week("dtRetro");
    await applyOvertime("t", ruleSet);
    expect(sunday()).toEqual([expect.objectContaining({ payBucket: "DT" })]);
    expect(total("DT")).toBe(510);
    expect(total("OT")).toBe(600);
  });

  it("stay regular under any other kind of code", async () => {
    week("regNoOt");
    await applyOvertime("t", ruleSet);
    expect(sunday()).toEqual([expect.objectContaining({ payBucket: "REG" })]);
    expect(total("REG")).toBe(2400 + 510);
    expect(total("OT")).toBe(600);
  });

  it("stay regular on a day still missing a punch", async () => {
    week("otRetro");
    db.exception.findMany.mockResolvedValue([{ occurredAt: new Date("2026-11-08T12:00:00Z") }]);
    await applyOvertime("t", ruleSet);
    expect(sunday()).toEqual([expect.objectContaining({ payBucket: "REG" })]);
  });
});

describe("exemptBucket", () => {
  it("keeps OT and DT, and makes everything else REG", () => {
    expect(exemptBucket("OT")).toBe("OT");
    expect(exemptBucket("DT")).toBe("DT");
    expect(exemptBucket("PTO")).toBe("REG");
    expect(exemptBucket(null)).toBe("REG");
  });
});
