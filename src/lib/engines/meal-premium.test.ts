// The engine reads calendar days in the process time zone; production runs in UTC.
process.env.TZ = "UTC";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { computeMealPremiums, mealMinutes } from "./segment-builder";

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
const novaTimeLike = { ...(ruleSet as object), mealBreakPremiumMaxPerDay: 2, mealPremiumRows: [
  { applyFromMinutes: 1, applyToMinutes: 299, minimumMealMinutes: 30, payMinutes: 60, payCodeId: "mp", unlessHoursExceed: false, unlessHoursExceedMinutes: 0, unlessPunchedMeal: false },
  { applyFromMinutes: 360, applyToMinutes: 719, minimumMealMinutes: 30, payMinutes: 60, payCodeId: "mp", unlessHoursExceed: true, unlessHoursExceedMinutes: 719, unlessPunchedMeal: false },
] } as never;
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
  it("does not count a missed clock out from an earlier day as worked until now (Krystle Brewster, 10/12)", () => {
    // 6:58 to 11:19, a 4 hour gap (a good first meal), back in 3:28 PM with no clock out; looked at 3 days later.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T09:00:00-07:00"));
    const p = computeMealPremiums("t", [work("06:58", "11:19")] as never, [punch("CLOCK_IN", "06:58"), punch("CLOCK_OUT", "11:19"), punch("CLOCK_IN", "15:28")] as never, novaTimeLike, TZ);
    vi.useRealTimers();
    expect(p.length).toBe(0);
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

// Mary Navarro, 10/19: in 7:00:03, out 11:33:21, back 12:03:04, out 3:30:04.
// The timecard shows a lunch of 11:33 to 12:03, 30 minutes, as NovaTime counts
// it; measured to the second it was 29:43 and drew a premium.
describe("a meal measured in whole minutes, as the timecard shows it", () => {
  const sec = (hhmmss: string) => new Date(`2026-10-13T${hhmmss}-07:00`);
  const navarro = () => {
    const ps = [["CLOCK_IN", "07:00:03"], ["CLOCK_OUT", "11:33:21"], ["CLOCK_IN", "12:03:04"], ["CLOCK_OUT", "15:30:04"]].map(([punchType, t]) => ({ punchType, punchTime: sec(t), roundedTime: sec(t) }));
    const segs = [
      { timesheetId: "t", segmentType: "WORK", startTime: sec("07:00:03"), endTime: sec("11:33:21"), durationMinutes: 273, segmentDate: day, isPaid: true, payBucket: "REG", isSplit: false },
      { timesheetId: "t", segmentType: "WORK", startTime: sec("12:03:04"), endTime: sec("15:30:04"), durationMinutes: 207, segmentDate: day, isPaid: true, payBucket: "REG", isSplit: false },
    ];
    return computeMealPremiums("t", segs as never, ps as never, ruleSet, TZ);
  };

  it("counts 11:33:21 to 12:03:04 as the 30-minute meal it shows as", () => {
    expect(navarro()).toEqual([]);
  });

  it("drops the seconds of both punches, never rounding up", () => {
    expect(mealMinutes(sec("11:33:21").getTime(), sec("12:03:04").getTime())).toBe(30);
    expect(mealMinutes(sec("11:33:59").getTime(), sec("12:03:00").getTime())).toBe(30);
    expect(mealMinutes(sec("11:33:00").getTime(), sec("12:02:59").getTime())).toBe(29);
  });

  it("still finds a meal of 29 whole minutes too short", () => {
    const ps = [["CLOCK_IN", "07:00:00"], ["CLOCK_OUT", "11:33:00"], ["CLOCK_IN", "12:02:00"], ["CLOCK_OUT", "15:30:00"]].map(([punchType, t]) => ({ punchType, punchTime: sec(t), roundedTime: sec(t) }));
    const segs = [
      { timesheetId: "t", segmentType: "WORK", startTime: sec("07:00:00"), endTime: sec("11:33:00"), durationMinutes: 273, segmentDate: day, isPaid: true, payBucket: "REG", isSplit: false },
      { timesheetId: "t", segmentType: "WORK", startTime: sec("12:02:00"), endTime: sec("15:30:00"), durationMinutes: 208, segmentDate: day, isPaid: true, payBucket: "REG", isSplit: false },
    ];
    expect(computeMealPremiums("t", segs as never, ps as never, ruleSet, TZ).length).toBe(1);
  });
});
