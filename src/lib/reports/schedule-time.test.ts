import { describe, expect, it } from "vitest";
import { nextRun, parseSchedule, zonedTimeToUtc } from "./schedule-time";
import { daysOf, describeSpan } from "./period";

const NY = "America/New_York";
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("nextRun", () => {
  it("reads the hour in the schedule's own zone, in winter and in summer", () => {
    // 8:00 AM Eastern is 12:00 UTC in summer (EDT) and 13:00 UTC in winter (EST).
    expect(iso(nextRun("0 8 * * *", NY, new Date("2026-10-02T15:00:00Z")))).toBe("2026-10-03T12:00:00.000Z");
    expect(iso(nextRun("0 8 * * *", NY, new Date("2026-12-02T15:00:00Z")))).toBe("2026-12-03T13:00:00.000Z");
  });

  it("is strictly after the moment given, so a run never repeats itself", () => {
    const at = new Date("2026-10-03T12:00:00Z");
    expect(iso(nextRun("0 8 * * *", NY, at))).toBe("2026-10-04T12:00:00.000Z");
  });

  it("sends weekly on the chosen weekday", () => {
    // Friday Oct 2, 2026, asking for Mondays at 6:30 AM Eastern.
    expect(iso(nextRun("30 6 * * 1", NY, new Date("2026-10-02T15:00:00Z")))).toBe("2026-10-05T10:30:00.000Z");
  });

  it("sends on the first of the month", () => {
    expect(iso(nextRun("0 7 1 * *", NY, new Date("2026-10-02T15:00:00Z")))).toBe("2026-11-01T12:00:00.000Z");
  });

  it("sends on the last day of the month, whatever its length", () => {
    expect(iso(nextRun("0 20 L * *", NY, new Date("2026-10-02T15:00:00Z")))).toBe("2026-11-01T00:00:00.000Z"); // Oct 31, 8 PM EDT
    expect(iso(nextRun("0 20 L * *", NY, new Date("2026-11-05T15:00:00Z")))).toBe("2026-12-01T01:00:00.000Z"); // Nov 30, 8 PM EST
    expect(iso(nextRun("0 20 L * *", NY, new Date("2027-02-05T15:00:00Z")))).toBe("2027-03-01T01:00:00.000Z"); // Feb 28, 2027
    expect(iso(nextRun("0 20 L * *", NY, new Date("2028-02-05T15:00:00Z")))).toBe("2028-03-01T01:00:00.000Z"); // Feb 29, 2028
  });

  it("sends once a year", () => {
    expect(iso(nextRun("0 8 1 1 *", NY, new Date("2026-10-02T15:00:00Z")))).toBe("2027-01-01T13:00:00.000Z");
  });

  it("sends on the 1st and 15th", () => {
    expect(iso(nextRun("0 8 1,15 * *", NY, new Date("2026-10-02T15:00:00Z")))).toBe("2026-10-15T12:00:00.000Z");
  });

  it("keeps the wall clock time across the change to winter time", () => {
    // Nov 1, 2026 is the day clocks go back. 8:00 AM that morning is EST.
    expect(iso(nextRun("0 8 * * *", NY, new Date("2026-10-31T13:00:00Z")))).toBe("2026-11-01T13:00:00.000Z");
  });

  it("does not skip a run on the day clocks go forward", () => {
    // Mar 8, 2026: 2:30 AM does not exist; the send lands once, after the jump.
    const first = nextRun("30 2 * * *", NY, new Date("2026-03-07T12:00:00Z"));
    const second = nextRun("30 2 * * *", NY, first!);
    expect(iso(first)).toBe("2026-03-08T07:30:00.000Z");
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
    expect(iso(second)).toBe("2026-03-09T06:30:00.000Z");
  });

  it("answers null for a day that never comes", () => {
    expect(nextRun("0 8 31 2 *", NY, new Date("2026-10-02T15:00:00Z"))).toBeNull();
  });

  it("refuses an expression it cannot read", () => {
    expect(() => parseSchedule("0 8 * *")).toThrow();
    expect(() => parseSchedule("0 25 * * *")).toThrow();
    expect(() => parseSchedule("x 8 * * *")).toThrow();
  });
});

describe("zonedTimeToUtc", () => {
  it("converts a Pacific wall clock", () => {
    expect(iso(zonedTimeToUtc(2026, 10, 2, 8, 0, "America/Los_Angeles"))).toBe("2026-10-02T15:00:00.000Z");
  });
});

describe("daysOf", () => {
  // Friday Oct 2, 2026, 11:00 AM Eastern.
  const now = new Date("2026-10-02T15:00:00Z");

  it("counts yesterday where the people are", () => {
    expect(daysOf({ type: "yesterday" }, NY, now)).toEqual({ start: "2026-10-01", end: "2026-10-01" });
    // 1:00 AM Eastern on Oct 3 is still Oct 2 evening in Pacific.
    expect(daysOf({ type: "yesterday" }, "America/Los_Angeles", new Date("2026-10-03T05:00:00Z"))).toEqual({ start: "2026-10-01", end: "2026-10-01" });
  });

  it("runs weeks Monday to Sunday", () => {
    expect(daysOf({ type: "calendar", unit: "week", which: "this" }, NY, now)).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(daysOf({ type: "calendar", unit: "week", which: "last" }, NY, now)).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });

  it("covers whole months and years", () => {
    expect(daysOf({ type: "calendar", unit: "month", which: "this" }, NY, now)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(daysOf({ type: "calendar", unit: "month", which: "last" }, NY, now)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(daysOf({ type: "calendar", unit: "month", which: "last" }, NY, new Date("2027-01-05T15:00:00Z"))).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(daysOf({ type: "calendar", unit: "year", which: "last" }, NY, now)).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });

  it("says it in words", () => {
    expect(describeSpan({ start: "2026-10-01", end: "2026-10-01" })).toBe("Oct 1, 2026");
    expect(describeSpan({ start: "2026-09-01", end: "2026-09-30" })).toBe("Sep 1 to Sep 30, 2026");
  });
});
