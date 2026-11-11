import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rbac/check-permission", () => ({ checkPermission: async () => false }));

import { MISSED_PUNCH_ONLY_ERROR, NOT_REGULAR_ROW_ERROR, isAbsentDay, mealWaiverRefusal, missedPunchRefusal } from "./missed-punch-fix";

// Eastern time: 8:00 AM on 11/03 is 13:00 UTC.
const tz = "America/New_York";
const at = (iso: string) => new Date(iso);
const p = (punchType: string, iso: string, payCodeId: string | null = null) => ({ punchType, roundedTime: at(iso), payCodeId });

describe("a supervisor allowed only to fix missed punches", () => {
  // Clocked in 8:00 AM on 11/03 and never out: 11/03 is marked Missed punch.
  const openShift = [p("CLOCK_IN", "2026-11-03T13:00:00Z")];
  const missed = new Set(["2026-11-03"]);

  it("adds the clock out a shift is missing, that day or after midnight", () => {
    expect(missedPunchRefusal([{ punchType: "CLOCK_OUT", at: at("2026-11-03T21:30:00Z") }], openShift, missed, tz)).toBeNull();
    expect(missedPunchRefusal([{ punchType: "CLOCK_OUT", at: at("2026-11-04T05:30:00Z") }], openShift, missed, tz)).toBeNull();
  });

  it("adds the clock in a shift is missing", () => {
    const noIn = [p("CLOCK_OUT", "2026-11-03T21:30:00Z")];
    expect(missedPunchRefusal([{ punchType: "CLOCK_IN", at: at("2026-11-03T13:00:00Z") }], noIn, missed, tz)).toBeNull();
  });

  it("adds no shift of their own: a clock in and a clock out on a day with nothing missing", () => {
    const fine = [p("CLOCK_IN", "2026-11-02T13:00:00Z"), p("CLOCK_OUT", "2026-11-02T21:30:00Z")];
    const added = [
      { punchType: "CLOCK_IN" as const, at: at("2026-11-05T13:00:00Z") },
      { punchType: "CLOCK_OUT" as const, at: at("2026-11-05T21:30:00Z") },
    ];
    expect(missedPunchRefusal(added, fine, new Set(), tz)).toBe(MISSED_PUNCH_ONLY_ERROR);
  });

  it("adds nothing to a day that is not marked Missed punch", () => {
    expect(missedPunchRefusal([{ punchType: "CLOCK_OUT", at: at("2026-11-03T21:30:00Z") }], openShift, new Set(), tz)).toBe(MISSED_PUNCH_ONLY_ERROR);
  });

  it("puts the clock out on the shift's day or the next, not days later", () => {
    expect(missedPunchRefusal([{ punchType: "CLOCK_OUT", at: at("2026-11-05T21:30:00Z") }], openShift, missed, tz)).toBe(MISSED_PUNCH_ONLY_ERROR);
  });

  it("adds no second clock out to a shift already closed, nor two of a kind at once", () => {
    const closed = [p("CLOCK_IN", "2026-11-03T13:00:00Z"), p("CLOCK_OUT", "2026-11-03T21:30:00Z")];
    expect(missedPunchRefusal([{ punchType: "CLOCK_OUT", at: at("2026-11-03T22:00:00Z") }], closed, missed, tz)).toBe(MISSED_PUNCH_ONLY_ERROR);
    const twoOuts = [
      { punchType: "CLOCK_OUT" as const, at: at("2026-11-03T21:30:00Z") },
      { punchType: "CLOCK_OUT" as const, at: at("2026-11-03T22:30:00Z") },
    ];
    expect(missedPunchRefusal(twoOuts, openShift, missed, tz)).toBe(MISSED_PUNCH_ONLY_ERROR);
  });

  it("puts the clock out after the meal, not in the middle of the shift", () => {
    const withMeal = [
      p("CLOCK_IN", "2026-11-03T13:00:00Z"),
      p("MEAL_START", "2026-11-03T17:00:00Z"),
      p("MEAL_END", "2026-11-03T17:30:00Z"),
    ];
    expect(missedPunchRefusal([{ punchType: "CLOCK_OUT", at: at("2026-11-03T16:00:00Z") }], withMeal, missed, tz)).toBe(MISSED_PUNCH_ONLY_ERROR);
    expect(missedPunchRefusal([{ punchType: "CLOCK_OUT", at: at("2026-11-03T21:30:00Z") }], withMeal, missed, tz)).toBeNull();
  });
});

// 11/06: they may also put times on a day marked Absent.
describe("a supervisor filling a day marked Absent", () => {
  // Tuesday 11/03 is a whole shift; Wednesday 11/04 is Absent.
  const tuesday = [p("CLOCK_IN", "2026-11-03T13:00:00Z"), p("CLOCK_OUT", "2026-11-03T21:30:00Z")];
  const absent = new Set(["2026-11-04"]);
  const shift = (inAt: string, outAt: string) => [
    { punchType: "CLOCK_IN" as const, at: at(inAt) },
    { punchType: "CLOCK_OUT" as const, at: at(outAt) },
  ];

  it("puts one shift on it, ending that day or after midnight", () => {
    expect(missedPunchRefusal(shift("2026-11-04T13:00:00Z", "2026-11-04T21:30:00Z"), tuesday, new Set(), tz, absent)).toBeNull();
    expect(missedPunchRefusal(shift("2026-11-04T22:00:00Z", "2026-11-05T06:30:00Z"), tuesday, new Set(), tz, absent)).toBeNull();
  });

  it("puts nothing on a day not marked Absent, nor half a shift on one that is", () => {
    expect(missedPunchRefusal(shift("2026-11-05T13:00:00Z", "2026-11-05T21:30:00Z"), tuesday, new Set(), tz, absent)).toBe(MISSED_PUNCH_ONLY_ERROR);
    expect(missedPunchRefusal([{ punchType: "CLOCK_IN", at: at("2026-11-04T13:00:00Z") }], tuesday, new Set(), tz, absent)).toBe(MISSED_PUNCH_ONLY_ERROR);
  });

  it("refuses a clock out before the clock in, or one that runs over the next day's punches", () => {
    expect(missedPunchRefusal(shift("2026-11-04T21:30:00Z", "2026-11-04T13:00:00Z"), tuesday, new Set(), tz, absent)).toBe(MISSED_PUNCH_ONLY_ERROR);
    const thursday = [...tuesday, p("CLOCK_IN", "2026-11-05T05:00:00Z")];
    expect(missedPunchRefusal(shift("2026-11-04T22:00:00Z", "2026-11-05T06:30:00Z"), thursday, new Set(), tz, absent)).toBe(MISSED_PUNCH_ONLY_ERROR);
  });

  it("calls a day Absent the way the timecard does", () => {
    const o = { today: "2026-11-06", periodStart: "2026-11-01", periodEnd: "2026-11-14", startedOn: "2020-01-01", endedOn: null, punchDays: new Set(["2026-11-03"]), segmentDays: new Set(["2026-11-02"]) };
    expect(isAbsentDay("2026-11-04", o)).toBe(true);
    expect(isAbsentDay("2026-11-01", o)).toBe(false); // Sunday
    expect(isAbsentDay("2026-11-02", o)).toBe(false); // leave or a pay code on it
    expect(isAbsentDay("2026-11-03", o)).toBe(false); // punches
    expect(isAbsentDay("2026-11-06", o)).toBe(false); // today
    expect(isAbsentDay("2026-10-30", o)).toBe(false); // another period
    expect(isAbsentDay("2026-11-04", { ...o, startedOn: "2026-11-05" })).toBe(false);
    expect(isAbsentDay("2026-11-04", { ...o, endedOn: "2026-11-03" })).toBe(false);
  });
});

// 11/10: on rows of regular hours only, and meal waivers but not premiums.
describe("a supervisor on rows of regular hours", () => {
  const missed = new Set(["2026-11-03"]);
  const out = [{ punchType: "CLOCK_OUT" as const, at: at("2026-11-03T21:30:00Z") }];

  it("closes a shift on the regular hours code, or on none", () => {
    expect(missedPunchRefusal(out, [p("CLOCK_IN", "2026-11-03T13:00:00Z", "reg")], missed, tz, new Set(), "reg")).toBeNull();
    expect(missedPunchRefusal(out, [p("CLOCK_IN", "2026-11-03T13:00:00Z")], missed, tz, new Set(), "reg")).toBeNull();
  });

  it("closes no shift HR put on another pay code, past a meal too", () => {
    expect(missedPunchRefusal(out, [p("CLOCK_IN", "2026-11-03T13:00:00Z", "ot")], missed, tz, new Set(), "reg")).toBe(NOT_REGULAR_ROW_ERROR);
    const withMeal = [p("CLOCK_IN", "2026-11-03T13:00:00Z", "pto"), p("MEAL_START", "2026-11-03T17:00:00Z"), p("MEAL_END", "2026-11-03T17:30:00Z")];
    expect(missedPunchRefusal(out, withMeal, missed, tz, new Set(), "reg")).toBe(NOT_REGULAR_ROW_ERROR);
  });

  it("waives a meal today or before, on a day of regular hours", () => {
    const o = { today: "2026-11-10", otherCodeDays: new Set(["2026-11-04"]) };
    expect(mealWaiverRefusal({ ...o, day: "2026-11-10" })).toBeNull();
    expect(mealWaiverRefusal({ ...o, day: "2026-11-03" })).toBeNull();
    expect(mealWaiverRefusal({ ...o, day: "2026-11-11" })).toMatch(/future date/);
    expect(mealWaiverRefusal({ ...o, day: "2026-11-04" })).toMatch(/day of regular hours/);
  });
});
