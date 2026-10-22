import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { pickMovingPeriod } from "./moving-period";
import { daysOf } from "./period";

// Bergen's biweekly fortnights, Sunday to Saturday.
const periods = [
  { id: "sep27", firstDay: "2026-09-27", lastDay: "2026-10-10" },
  { id: "oct11", firstDay: "2026-10-11", lastDay: "2026-10-24" },
  { id: "oct25", firstDay: "2026-10-25", lastDay: "2026-11-07" },
];

describe("pickMovingPeriod", () => {
  it("finds the period running today and the one before it", () => {
    expect(pickMovingPeriod(periods, "current", "2026-10-22")?.id).toBe("oct11");
    expect(pickMovingPeriod(periods, "previous", "2026-10-22")?.id).toBe("sep27");
  });

  it("counts the first and last day as inside", () => {
    expect(pickMovingPeriod(periods, "current", "2026-10-11")?.id).toBe("oct11");
    expect(pickMovingPeriod(periods, "current", "2026-10-24")?.id).toBe("oct11");
    expect(pickMovingPeriod(periods, "current", "2026-10-25")?.id).toBe("oct25");
  });

  it("never picks a period that has not started", () => {
    expect(pickMovingPeriod(periods, "current", "2026-09-01")).toBeUndefined();
  });

  it("falls back to the latest started period when none covers today", () => {
    expect(pickMovingPeriod(periods.slice(0, 2), "current", "2026-12-01")?.id).toBe("oct11");
  });
});

describe("daysOf weeks", () => {
  // Thursday, Oct 22, 2026, at noon in New York.
  const now = new Date("2026-10-22T16:00:00Z");

  it("starts the week on Sunday for a company whose week starts Sunday", () => {
    expect(daysOf({ type: "calendar", unit: "week", which: "this" }, "America/New_York", now, 0)).toEqual({ start: "2026-10-18", end: "2026-10-24" });
    expect(daysOf({ type: "calendar", unit: "week", which: "last" }, "America/New_York", now, 0)).toEqual({ start: "2026-10-11", end: "2026-10-17" });
  });

  it("keeps Monday to Sunday when no week start is given", () => {
    expect(daysOf({ type: "calendar", unit: "week", which: "this" }, "America/New_York", now)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
  });
});
