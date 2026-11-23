// The engine reads calendar days in the process time zone; production runs in UTC.
process.env.TZ = "UTC";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Seg = { segmentDate: Date; durationMinutes: number; payBucket: string };

const state = vi.hoisted(() => ({
  holidays: [] as { date: Date; observedDate: Date | null; bypassAfterEligibility: boolean }[],
  own: [] as Seg[],
  other: [] as Seg[],
  otherPunches: [] as { roundedTime: Date }[],
  created: [] as { segmentDate: Date; durationMinutes: number; segmentType: string }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    holidayRuleHoliday: { count: async () => 1 },
    holiday: { findMany: async () => state.holidays },
    workSegment: {
      // The holiday's own timecard, or (by employee) the person's other ones.
      findMany: async (args: { where: { timesheet?: unknown; segmentDate?: { in: Date[] } } }) =>
        args.where.timesheet
          ? state.other.filter((s) => args.where.segmentDate!.in.some((d) => d.getTime() === s.segmentDate.getTime()))
          : state.own,
      createMany: async ({ data }: { data: typeof state.created }) => {
        state.created.push(...data);
        return { count: data.length };
      },
    },
    punch: { findMany: async () => state.otherPunches },
    overtimeBucket: { upsert: async () => ({}) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

import { autoPaidDays, syncHolidayCredits } from "./segment-builder";

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const work = (d: string, mins = 480): Seg => ({ segmentDate: day(d), durationMinutes: mins, payBucket: "REG" });
const holiday = (d: string, observed: string | null = null) => ({ date: day(d), observedDate: observed ? day(observed) : null, bypassAfterEligibility: false });
const MON_FRI = { startTime: "08:00", endTime: "16:30", workDays: [1, 2, 3, 4, 5] };

// A US policy: 8 hours, worked the day before and the day after.
const US_RULE = {
  id: "rule", payCodeId: "holiday-code", creditMethod: "FIXED_HOURS" as const, creditMinutes: 480, maxCreditMinutes: 0,
  payBucket: "HOLIDAY" as const, workingPremium: 100, requireDayBefore: true, requireDayAfter: true,
  requireDayBeforeOrAfter: false, minPeriodMinutes: 0, mustNotWorkOnHoliday: false, payNonWorkingHolidayOnly: false,
  requireDaysWorkedEnabled: false, requireDaysWorkedCount: 0, requireDaysWorkedPeriod: 0, requireDaysWorkedPeriodUnit: "DAY",
  requireDaysWorkedMinDailyHours: 0, requireScheduledHoursPct: false, requireScheduledHoursPctValue: 0,
  bypassAfterEligibility: false, excludedWeekDays: [], countTowardOt: false, includeOnProbation: false, probationDays: 90,
  tenureRequiredEnabled: true, tenureRequiredDays: 90, tenureRequiredBasis: "HIRE_DATE", tenureRequiredUnit: "DAYS",
  prorateEnabled: false, prorateLookbackDays: 0, prorateIncludeCurrentWeek: false, prorateAppliedRule: "THRESHOLD",
  prorateThresholdHours: 0, prorateMultiplier: 1, prorateAverageDailyMaxHours: 0, prorateExcludeOt: false,
  postWorkingHoursToAccrual: false, postWorkingHoursMax: 0, postWorkingHoursExcessEnabled: false,
  postWorkingHoursExcessMin: 0, accrualCode: null, birthdayIsHoliday: false, holidayOverridesEnabled: false,
  holidayOverrides: null,
};
const EMPLOYEE = { id: "emp", hireDate: day("2020-01-06"), adjustedHireDate: null, dateOfBirth: null };

function credit(first: string, last: string, rule = US_RULE, autoPaid = new Set<string>()) {
  return syncHolidayCredits("ts", "America/New_York", day(first), day(last), [], rule, "tenant", MON_FRI, EMPLOYEE, 0, autoPaid);
}

beforeEach(() => {
  state.holidays = []; state.own = []; state.other = []; state.otherPunches = []; state.created = [];
});
afterEach(() => vi.useRealTimers());

describe("holiday hours", () => {
  it("credits New Year's Day when the work day after it is on the next timecard (period 12/20 to 1/2)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-05T15:00:00Z"));
    state.holidays = [holiday("2027-01-01")];
    state.own = [work("2026-12-30"), work("2026-12-31")];
    state.other = [work("2027-01-04")];

    const paid = await credit("2026-12-20", "2027-01-02");

    expect([...paid]).toEqual(["2027-01-01"]);
    expect(state.created).toEqual([expect.objectContaining({ segmentType: "HOLIDAY", segmentDate: day("2027-01-01"), durationMinutes: 480 })]);
  });

  it("counts a clock punch on the next timecard before its hours are worked out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-05T15:00:00Z"));
    state.holidays = [holiday("2027-01-01")];
    state.own = [work("2026-12-31")];
    state.otherPunches = [{ roundedTime: new Date("2027-01-04T13:00:00Z") }]; // 8 AM Eastern, Monday 1/4

    expect([...(await credit("2026-12-20", "2027-01-02"))]).toEqual(["2027-01-01"]);
  });

  it("still holds New Year's Day back from someone who missed the Monday after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-05T15:00:00Z"));
    state.holidays = [holiday("2027-01-01")];
    state.own = [work("2026-12-31")];
    state.other = [work("2027-01-05")]; // came back Tuesday

    expect((await credit("2026-12-20", "2027-01-02")).size).toBe(0);
    expect(state.created).toEqual([]);
  });

  it("reads the work day before from the previous timecard (July 4th 2027, paid Monday 7/5)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-07-08T15:00:00Z"));
    state.holidays = [holiday("2027-07-04", "2027-07-05")];
    state.own = [work("2027-07-06")];
    state.other = [work("2027-07-02")];

    expect([...(await credit("2027-07-04", "2027-07-17"))]).toEqual(["2027-07-05"]);
  });

  it("credits a holiday on the period's last day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-30T15:00:00Z"));
    state.holidays = [holiday("2026-12-26")];
    const noDaysAround = { ...US_RULE, requireDayBefore: false, requireDayAfter: false, tenureRequiredEnabled: false };

    expect([...(await credit("2026-12-20", "2026-12-26", noDaysAround))]).toEqual(["2026-12-26"]);
  });

  it("pays a salaried day as the holiday from the start, before the days around it (Thanksgiving, seen 11/23)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T15:00:00Z"));
    state.holidays = [holiday("2026-11-26")];
    state.own = [work("2026-11-23"), work("2026-11-24"), work("2026-11-25"), work("2026-11-26"), work("2026-11-27")];

    const paid = await credit("2026-11-22", "2026-12-05", US_RULE, new Set(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]));

    expect([...paid]).toEqual(["2026-11-26"]);
  });

  it("pays a salaried New Year's Day without the Monday after, on the next timecard", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-21T15:00:00Z"));
    state.holidays = [holiday("2027-01-01")];
    state.own = [work("2026-12-31"), work("2027-01-01")];

    expect([...(await credit("2026-12-20", "2027-01-02", US_RULE, new Set(["2026-12-31", "2027-01-01"])))]).toEqual(["2027-01-01"]);
  });

  it("keeps a new salaried hire's holiday as their salary hours (90 days' service)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T15:00:00Z"));
    state.holidays = [holiday("2026-11-26")];
    state.own = [work("2026-11-26")];
    const newHire = { ...EMPLOYEE, hireDate: day("2026-10-01") };

    const paid = await syncHolidayCredits("ts", "America/New_York", day("2026-11-22"), day("2026-12-05"), [], US_RULE, "tenant", MON_FRI, newHire, 0, new Set(["2026-11-26"]));

    expect(paid.size).toBe(0);
    expect(state.created).toEqual([]);
  });

  it("still waits for an hourly person's day after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    state.holidays = [holiday("2026-11-26")];
    state.own = [work("2026-11-25")];

    expect((await credit("2026-11-22", "2026-12-05")).size).toBe(0);
  });

  it("does not read a salaried day paid automatically as work on the holiday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
    state.holidays = [holiday("2026-11-26")];
    state.own = [work("2026-11-25"), work("2026-11-26"), work("2026-11-27")];
    const premium = { ...US_RULE, workingPremium: 150 };

    const paid = await credit("2026-11-22", "2026-12-05", premium, new Set(["2026-11-25", "2026-11-26", "2026-11-27"]));

    expect([...paid]).toEqual(["2026-11-26"]);
    // The 8 holiday hours only: no premium for hours nobody clocked.
    expect(state.created.map((s) => s.durationMinutes)).toEqual([480]);
  });
});

describe("the days given salary hours automatically", () => {
  it("leaves out a day whose hours carry a code picked for it", () => {
    const hours = (d: string) => ({ segmentDate: day(d) }) as Parameters<typeof autoPaidDays>[0][number];
    const days = autoPaidDays([hours("2026-11-25"), hours("2026-11-26")], new Map([["2026-11-25", { payCodeId: "pto", leaveRequestId: "req" }]]));
    expect([...days]).toEqual(["2026-11-26"]);
  });
});
