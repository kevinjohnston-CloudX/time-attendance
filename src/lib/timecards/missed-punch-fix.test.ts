import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rbac/check-permission", () => ({ checkPermission: async () => false }));

import { MISSED_PUNCH_ONLY_ERROR, addTimeRefusal, isAbsentDay, missedPunchRefusal } from "./missed-punch-fix";

// Eastern time: 8:00 AM on 11/03 is 13:00 UTC.
const tz = "America/New_York";
const at = (iso: string) => new Date(iso);
const p = (punchType: string, iso: string) => ({ punchType, roundedTime: at(iso) });

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

// 11/09: Add time again, as regular hours, today or before, on an open timecard.
describe("a supervisor adding time", () => {
  const ok = { status: "OPEN", day: "2026-11-09", today: "2026-11-09", regularCodeId: "reg" };

  it("adds regular hours today or on a day before it", () => {
    expect(addTimeRefusal(ok)).toBeNull();
    expect(addTimeRefusal({ ...ok, day: "2026-11-02", payCodeId: "reg", hours: 8 })).toBeNull();
  });

  it("adds nothing for a future date", () => {
    expect(addTimeRefusal({ ...ok, day: "2026-11-10" })).toMatch(/future date/);
  });

  it("adds no other pay code", () => {
    expect(addTimeRefusal({ ...ok, payCodeId: "pto" })).toMatch(/only as regular hours/);
  });

  it("adds nothing to a timecard that is not open", () => {
    for (const status of ["SUBMITTED", "SUP_APPROVED", "PAYROLL_APPROVED", "LOCKED"]) {
      expect(addTimeRefusal({ ...ok, status })).toMatch(/open timecard/);
    }
  });

  it("adds no 0 hour entry, which only marks the day with a pay code", () => {
    expect(addTimeRefusal({ ...ok, hours: 0 })).toMatch(/more than 0/);
  });
});
