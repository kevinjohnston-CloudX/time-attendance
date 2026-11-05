import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rbac/check-permission", () => ({ checkPermission: async () => false }));

import { MISSED_PUNCH_ONLY_ERROR, missedPunchRefusal } from "./missed-punch-fix";

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
