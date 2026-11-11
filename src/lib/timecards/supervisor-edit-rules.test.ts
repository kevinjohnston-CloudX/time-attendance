import { describe, expect, it } from "vitest";
import {
  FUTURE_DAY_ERROR,
  REGULAR_HOURS_ONLY_ERROR,
  addTimeRefusal,
  describeEditItem,
  landsOnRegularRow,
  mealWaiverRefusal,
  onRegularRow,
  punchChangeRefusal,
  type RowPunch,
} from "./supervisor-edit-rules";

// Eastern time: 7:31 AM on 11/03 is 12:31 UTC. "reg" is the rule set's regular hours code.
const p = (id: string, punchType: string, iso: string, payCodeId: string | null = null): RowPunch => ({ id, punchType, roundedTime: new Date(iso), payCodeId });
const at = (iso: string) => new Date(iso);
const tz = "America/New_York";

// 11/03 regular hours, 7:31 AM to 4:00 PM, with a meal; 11/04 coded overtime by HR.
const punches = [
  p("in3", "CLOCK_IN", "2026-11-03T12:31:00Z", "reg"),
  p("ms3", "MEAL_START", "2026-11-03T16:00:00Z"),
  p("me3", "MEAL_END", "2026-11-03T16:30:00Z"),
  p("out3", "CLOCK_OUT", "2026-11-03T21:00:00Z"),
  p("in4", "CLOCK_IN", "2026-11-04T12:30:00Z", "ot"),
  p("out4", "CLOCK_OUT", "2026-11-04T21:00:00Z"),
];
const base = { punches, regularCodeId: "reg", today: "2026-11-10", codedDays: new Set<string>() };

describe("what a supervisor may send HR (11/11)", () => {
  it("changes a punch on a regular hours row: 7:31 to 7:30", () => {
    expect(onRegularRow(punches[0], punches, "reg")).toBe(true);
    expect(punchChangeRefusal({ ...base, punch: punches[0], landing: [at("2026-11-03T12:30:00Z")], days: ["2026-11-03"] })).toBeNull();
    expect(punchChangeRefusal({ ...base, punch: punches[3], landing: [at("2026-11-03T21:15:00Z")], days: ["2026-11-03"] })).toBeNull();
  });

  it("changes nothing on a row HR put on another code, and moves nothing into one", () => {
    expect(punchChangeRefusal({ ...base, punch: punches[5], landing: [at("2026-11-04T21:30:00Z")], days: ["2026-11-04"] })).toBe(REGULAR_HOURS_ONLY_ERROR);
    expect(landsOnRegularRow(at("2026-11-04T16:00:00Z"), punches, "reg")).toBe(false);
    expect(punchChangeRefusal({ ...base, punch: punches[3], landing: [at("2026-11-04T16:00:00Z")], days: ["2026-11-04"] })).toBe(REGULAR_HOURS_ONLY_ERROR);
  });

  it("removes a punch on a regular row only", () => {
    expect(punchChangeRefusal({ ...base, punch: punches[1], landing: [], days: [] })).toBeNull();
    expect(punchChangeRefusal({ ...base, punch: punches[4], landing: [], days: [] })).toBe(REGULAR_HOURS_ONLY_ERROR);
  });

  it("adds a missed clock out or clock in, and fills a day with nothing on it", () => {
    const open = [p("in", "CLOCK_IN", "2026-11-05T12:00:00Z", "reg")];
    expect(punchChangeRefusal({ ...base, punches: open, landing: [at("2026-11-05T21:00:00Z")], days: ["2026-11-05"] })).toBeNull();
    expect(punchChangeRefusal({ ...base, landing: [at("2026-11-06T12:00:00Z"), at("2026-11-06T20:30:00Z")], days: ["2026-11-06", "2026-11-06"] })).toBeNull();
  });

  it("puts nothing on a future date, or on a day HR coded", () => {
    expect(punchChangeRefusal({ ...base, landing: [at("2026-11-11T12:30:00Z")], days: ["2026-11-11"] })).toBe(FUTURE_DAY_ERROR);
    expect(punchChangeRefusal({ ...base, codedDays: new Set(["2026-11-06"]), landing: [at("2026-11-06T12:30:00Z")], days: ["2026-11-06"] })).toBe(REGULAR_HOURS_ONLY_ERROR);
  });

  it("adds time today or before, on an open timecard, and not on a coded day", () => {
    const ok = { status: "OPEN", day: "2026-11-10", today: "2026-11-10", codedDays: new Set<string>() };
    expect(addTimeRefusal({ ...ok, pair: { at: at("2026-11-10T13:00:00Z"), endAt: at("2026-11-10T21:30:00Z") } })).toBeNull();
    expect(addTimeRefusal({ ...ok, minutes: 480 })).toBeNull();
    expect(addTimeRefusal({ ...ok, day: "2026-11-11" })).toMatch(/future date/);
    expect(addTimeRefusal({ ...ok, status: "LOCKED" })).toMatch(/open timecard/);
    expect(addTimeRefusal({ ...ok, codedDays: new Set(["2026-11-10"]) })).toBe(REGULAR_HOURS_ONLY_ERROR);
    expect(addTimeRefusal({ ...ok, pair: { at: at("2026-11-10T21:30:00Z"), endAt: at("2026-11-10T13:00:00Z") } })).toMatch(/after the in time/);
    expect(addTimeRefusal({ ...ok, minutes: 0 })).toMatch(/more than 0/);
  });

  it("waives a meal today or before, on a day of regular hours", () => {
    const o = { today: "2026-11-10", otherCodeDays: new Set(["2026-11-04"]) };
    expect(mealWaiverRefusal({ ...o, day: "2026-11-03" })).toBeNull();
    expect(mealWaiverRefusal({ ...o, day: "2026-11-11" })).toMatch(/future date/);
    expect(mealWaiverRefusal({ ...o, day: "2026-11-04" })).toMatch(/day of regular hours/);
  });

  it("says each change as HR reads it", () => {
    expect(describeEditItem({ kind: "CHANGE_PUNCH", punchType: "CLOCK_IN", before: "2026-11-03T12:31:00Z", at: "2026-11-03T12:30:00Z" }, tz)).toBe("Change clock in 7:31 AM to 7:30 AM");
    expect(describeEditItem({ kind: "ADD_PUNCH", punchType: "CLOCK_OUT", at: "2026-11-03T21:16:00Z" }, tz)).toBe("Add clock out 4:16 PM");
    expect(describeEditItem({ kind: "REMOVE_PUNCH", punchType: "CLOCK_OUT", before: "2026-11-03T21:00:00Z" }, tz)).toBe("Remove clock out 4:00 PM");
    expect(describeEditItem({ kind: "ADD_PAIR", at: "2026-11-03T13:00:00Z", endAt: "2026-11-03T21:30:00Z" }, tz)).toBe("Add time 8:00 AM to 4:30 PM");
    expect(describeEditItem({ kind: "ADD_HOURS", minutes: 480 }, tz)).toBe("Add 8.00 hours");
    expect(describeEditItem({ kind: "MEAL_WAIVER", waive: true }, tz)).toBe("Waive the meal");
  });
});
