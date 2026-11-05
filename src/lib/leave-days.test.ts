import { describe, expect, it } from "vitest";
import { daySeconds, leaveDayKeys } from "./leave-days";

const H = 3600;

describe("leaveDayKeys", () => {
  it("takes the days picked, not every day between", () => {
    expect(
      leaveDayKeys({
        startDate: new Date("2026-11-13T00:00:00Z"),
        endDate: new Date("2026-11-23T00:00:00Z"),
        selectedDays: [{ date: "2026-11-23", type: "FULL" }, { date: "2026-11-13", type: "FULL" }],
      }),
    ).toEqual(["2026-11-13", "2026-11-23"]);
  });

  it("falls back to every day from first to last when no days were kept", () => {
    expect(leaveDayKeys({ startDate: "2026-11-13", endDate: "2026-11-16", selectedDays: null })).toEqual([
      "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16",
    ]);
  });
});

describe("daySeconds", () => {
  it("puts each full day's share on the picked days only", () => {
    const m = daySeconds([{ date: "2026-11-13", type: "FULL" }, { date: "2026-11-23", type: "FULL" }], 16 * H, "2026-11-13", "2026-11-23");
    expect([...m!.entries()]).toEqual([["2026-11-13", 8 * H], ["2026-11-23", 8 * H]]);
  });

  it("gives a partial day its own minutes and the full days the rest", () => {
    const m = daySeconds(
      [{ date: "2026-11-13", type: "FULL" }, { date: "2026-11-16", type: "PARTIAL", minutes: 240 }],
      12 * H, "2026-11-13", "2026-11-16",
    );
    expect(m!.get("2026-11-13")).toBe(8 * H);
    expect(m!.get("2026-11-16")).toBe(4 * H);
  });

  it("always adds up to the request's total", () => {
    const m = daySeconds(
      [{ date: "2026-11-11", type: "FULL" }, { date: "2026-11-12", type: "FULL" }, { date: "2026-11-13", type: "FULL" }],
      1000, "2026-11-11", "2026-11-13",
    );
    expect([...m!.values()].reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("is null when the request kept no days", () => {
    expect(daySeconds(null, 8 * H, "2026-11-13", "2026-11-13")).toBeNull();
    expect(daySeconds([], 8 * H, "2026-11-13", "2026-11-13")).toBeNull();
  });
});
