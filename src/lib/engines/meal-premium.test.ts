// The engine reads calendar days in the process time zone; production runs in UTC.
process.env.TZ = "UTC";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { computeMealPremiums } from "./segment-builder";

// California, as configured: a meal starting by minute 299, at least 30 minutes; 1 hour premium.
const ruleSet = {
  mealBreakPremiumEnabled: true,
  mealBreakPremiumMaxPerDay: 1,
  mealPremiumUseActualForWindow: true,
  mealPremiumUseActualForMinimum: true,
  mealPremiumLimitToPayMinutes: false,
  mealPremiumRows: [
    { applyFromMinutes: 1, applyToMinutes: 299, minimumMealMinutes: 30, payMinutes: 60, payCodeId: "mp", unlessHoursExceed: false, unlessHoursExceedMinutes: 0, unlessPunchedMeal: false },
    { applyFromMinutes: 360, applyToMinutes: 599, minimumMealMinutes: 30, payMinutes: 60, payCodeId: "mp", unlessHoursExceed: false, unlessHoursExceedMinutes: 0, unlessPunchedMeal: false },
  ],
} as never;
const TZ = "America/Los_Angeles";
const day = new Date("2026-10-13T00:00:00.000Z");
const at = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00-07:00`);
const punch = (punchType: string, hhmm: string) => ({ punchType, punchTime: at(hhmm), roundedTime: at(hhmm) });
const work = (from: string, to: string) => ({ timesheetId: "t", segmentType: "WORK", startTime: at(from), endTime: at(to), durationMinutes: (at(to).getTime() - at(from).getTime()) / 60_000, segmentDate: day, isPaid: true, payBucket: "REG", isSplit: false });
const premiums = (pairs: [string, string][], openFrom?: string) => {
  const punches = pairs.flatMap(([a, b]) => [punch("CLOCK_IN", a), punch("CLOCK_OUT", b)]);
  if (openFrom) punches.push(punch("CLOCK_IN", openFrom));
  return computeMealPremiums("t", pairs.map(([a, b]) => work(a, b)) as never, punches as never, ruleSet, TZ).length;
};

describe("California meal premium", () => {
  it("is not owed for exactly 5 hours worked (Alexandra Escalante, 10/13: 8:00 to 1:00)", () => {
    expect(premiums([["08:00", "13:00"]])).toBe(0);
  });
  it("is owed past 5 hours with no meal", () => {
    expect(premiums([["08:00", "13:15"]])).toBe(1);
  });
  it("is owed for a meal under 30 minutes (Karla Valdovinos, 10/12: out 12:36, back 1:04)", () => {
    expect(premiums([["08:01", "12:36"], ["13:04", "16:27"]])).toBe(1);
  });
  it("is not owed for a 30-minute meal started by the end of the 5th hour", () => {
    expect(premiums([["08:00", "12:30"], ["13:00", "16:30"]])).toBe(0);
  });
  it("does not count time off the clock as worked", () => {
    // 4 hours, a 2 hour gap, 1 more hour: 5 hours worked, nothing owed.
    expect(premiums([["08:00", "12:00"], ["14:00", "15:00"]])).toBe(0);
  });
  it("is not owed on a shift still open after half an hour", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("08:30"));
    const p = computeMealPremiums("t", [] as never, [punch("CLOCK_IN", "08:00")] as never, ruleSet, TZ);
    vi.useRealTimers();
    expect(p.length).toBe(0);
  });
  it("counts a hand-entered shift past midnight on the day it starts (7:00 PM to 12:30 AM, no meal)", () => {
    const inT = at("19:00");
    const outT = new Date("2026-10-14T00:30:00-07:00");
    const seg = { timesheetId: "t", segmentType: "WORK", startTime: inT, endTime: outT, durationMinutes: 330, segmentDate: day, isPaid: true, payBucket: "REG", isSplit: false };
    const ps = [punch("CLOCK_IN", "19:00"), { punchType: "CLOCK_OUT", punchTime: outT, roundedTime: outT }];
    expect(computeMealPremiums("t", [seg] as never, ps as never, ruleSet, TZ).length).toBe(1);
  });
  it("pays at most one hour a day", () => {
    // 12 hours straight: both meals missed, one premium.
    expect(premiums([["06:00", "18:30"]])).toBe(1);
  });
});

// CA Hourly as set up in NovaTime: up to 2 a day; the second meal between hour
// 6 and 11.98, which can be waived unless the day is over 11.98 hours.
describe("California meal premium, NovaTime's setup", () => {
  const novaTime = {
    ...(ruleSet as object),
    mealBreakPremiumMaxPerDay: 2,
    mealPremiumRows: [
      { applyFromMinutes: 1, applyToMinutes: 299, minimumMealMinutes: 30, payMinutes: 60, payCodeId: "mp", unlessHoursExceed: false, unlessHoursExceedMinutes: 0, unlessPunchedMeal: false },
      { applyFromMinutes: 360, applyToMinutes: 719, minimumMealMinutes: 30, payMinutes: 60, payCodeId: "mp", unlessHoursExceed: true, unlessHoursExceedMinutes: 719, unlessPunchedMeal: false },
    ],
  } as never;
  const run = (pairs: [string, string][], waived: (day: string, row: number) => boolean = () => false) =>
    computeMealPremiums(
      "t",
      pairs.map(([a, b]) => work(a, b)) as never,
      pairs.flatMap(([a, b]) => [punch("CLOCK_IN", a), punch("CLOCK_OUT", b)]) as never,
      novaTime,
      TZ,
      (d, row) => waived(d, row),
    ).map((p) => p.premiumRow);

  it("pays the second meal past 12 hours with no second meal", () => {
    // First meal 11:00 to 11:30, then straight through to 8:00 PM: 12.5 hours worked.
    expect(run([["07:00", "11:00"], ["11:30", "20:00"]])).toEqual([1]);
  });
  it("pays both meals on a long day with no meals", () => {
    expect(run([["06:00", "18:30"]])).toEqual([0, 1]);
  });
  it("keeps a second meal waiver on a day of 12 hours or less", () => {
    // 4 + 8 hours = 12.0 worked: the second meal is not owed at all yet.
    expect(run([["07:00", "11:00"], ["11:30", "19:30"]], (_, row) => row === 1)).toEqual([]);
  });
  it("does not hold a second meal waiver past the 11.98 hours", () => {
    expect(run([["07:00", "11:00"], ["11:30", "20:00"]], (_, row) => row === 1)).toEqual([1]);
  });
  it("holds a first meal waiver, which has no hours limit", () => {
    expect(run([["08:00", "14:00"]], (_, row) => row === 0)).toEqual([]);
  });
});
