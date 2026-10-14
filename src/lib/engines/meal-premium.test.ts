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
  it("pays at most one hour a day", () => {
    // 12 hours straight: both meals missed, one premium.
    expect(premiums([["06:00", "18:30"]])).toBe(1);
  });
});
