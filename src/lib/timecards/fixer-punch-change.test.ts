import { describe, expect, it } from "vitest";
import { PUNCH_CHANGE_ERROR, PUNCH_CHANGE_ROW_ERROR, PUNCH_REMOVE_ERROR, fixerPunchChangeRefusal, type ChangePunch } from "./fixer-punch-change";

// Eastern standard time: 8:03 AM on 11/10 is 13:03 UTC.
const p = (id: string, punchType: string, iso: string, extra: Partial<ChangePunch> = {}): ChangePunch => ({ id, punchType, roundedTime: new Date(iso), payCodeId: null, ...extra });
const dayOf = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(at);
const base = { regularCodeId: "reg", today: "2026-11-11", dayOf };

// Heliana Salazar, Tue 11/10: missed the lunch clock out at 2:11 PM, so the
// clock read in 8:03, out 3:11, in 5:16, and a clock out Missing.
const tuesday = [
  p("in1", "CLOCK_IN", "2026-11-10T13:03:00Z"),
  p("out1", "CLOCK_OUT", "2026-11-10T20:11:00Z"),
  p("in2", "CLOCK_IN", "2026-11-10T22:16:00Z"),
];
const missed = new Set(["2026-11-10"]);

describe("a supervisor changing saved punches (11/11)", () => {
  it("puts a missed lunch right: 3:11 out to 2:11, 5:16 in to 3:11", () => {
    const o = { ...base, punches: tuesday, missedDays: missed };
    expect(fixerPunchChangeRefusal({ ...o, punch: tuesday[1], newTime: new Date("2026-11-10T19:11:00Z") })).toBeNull();
    expect(fixerPunchChangeRefusal({ ...o, punch: tuesday[2], newTime: new Date("2026-11-10T20:11:00Z") })).toBeNull();
  });

  it("changes nothing on a day not marked Missed punch, unless they entered it", () => {
    const o = { ...base, punches: tuesday, missedDays: new Set<string>() };
    expect(fixerPunchChangeRefusal({ ...o, punch: tuesday[1], newTime: new Date("2026-11-10T19:11:00Z") })).toBe(PUNCH_CHANGE_ERROR);
    const mine = { ...tuesday[1], mine: true };
    expect(fixerPunchChangeRefusal({ ...o, punches: [tuesday[0], mine, tuesday[2]], punch: mine, newTime: new Date("2026-11-10T19:11:00Z") })).toBeNull();
  });

  it("removes only a punch they entered", () => {
    const o = { ...base, punches: tuesday, missedDays: missed };
    expect(fixerPunchChangeRefusal({ ...o, punch: tuesday[2], newTime: null })).toBe(PUNCH_REMOVE_ERROR);
    expect(fixerPunchChangeRefusal({ ...o, punch: { ...tuesday[2], mine: true }, newTime: null })).toBeNull();
  });

  it("changes nothing on a row of another pay code", () => {
    const ot = [p("in1", "CLOCK_IN", "2026-11-10T13:03:00Z", { payCodeId: "ot" }), tuesday[1]];
    expect(fixerPunchChangeRefusal({ ...base, punches: ot, missedDays: missed, punch: ot[1], newTime: new Date("2026-11-10T19:11:00Z") })).toBe(PUNCH_CHANGE_ROW_ERROR);
    expect(fixerPunchChangeRefusal({ ...base, punches: ot, missedDays: missed, punch: { ...ot[1], mine: true }, newTime: null })).toBe(PUNCH_CHANGE_ROW_ERROR);
  });

  it("keeps the time on the shift's day or after midnight, and not in the future", () => {
    const o = { ...base, punches: tuesday, missedDays: missed };
    expect(fixerPunchChangeRefusal({ ...o, punch: tuesday[1], newTime: new Date("2026-11-11T06:00:00Z") })).toBeNull(); // 1:00 AM 11/11
    expect(fixerPunchChangeRefusal({ ...o, punch: tuesday[1], newTime: new Date("2026-11-08T20:00:00Z") })).toMatch(/shift's day/);
    expect(fixerPunchChangeRefusal({ ...o, today: "2026-11-10", punch: tuesday[1], newTime: new Date("2026-11-11T06:00:00Z") })).toMatch(/future date/);
  });
});
