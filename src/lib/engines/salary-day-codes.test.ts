// The engine reads calendar days in the process time zone; production runs in UTC.
process.env.TZ = "UTC";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { chooseDayCodes } from "./segment-builder";

// Salary hours start at midnight UTC of their day; the day's own code is a
// 0-minute line on the same date.
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const hours = (d: string, payCodeId: string, leaveRequestId: string | null = null) => ({ segmentDate: day(d), startTime: day(d), payCodeId, leaveRequestId });
const dayCode = (d: string, payCodeId: string) => ({ segmentDate: day(d), payCodeId });
const SAL = "salary";

describe("the code a salaried day keeps through a recalculation", () => {
  it("takes the day's code over the default on its hours (Sandra Williams, 10/2 and 10/5)", () => {
    const chosen = chooseDayCodes(
      [hours("2026-10-02", SAL), hours("2026-10-05", SAL)],
      [dayCode("2026-10-02", "pto-carryover"), dayCode("2026-10-05", "floating-holiday")],
      new Set(),
      [SAL],
    );
    expect(chosen.get("2026-10-02")?.payCodeId).toBe("pto-carryover");
    expect(chosen.get("2026-10-05")?.payCodeId).toBe("floating-holiday");
  });

  it("keeps a code given to the hours, and the leave it took, when the day has no code", () => {
    const chosen = chooseDayCodes([hours("2026-09-30", "pto", "req-1")], [], new Set(), [SAL]);
    expect(chosen.get("2026-09-30")).toEqual({ payCodeId: "pto", leaveRequestId: "req-1" });
  });

  it("keeps the hours' leave code over a day's code left at the default (Anton Semeniak, 9/28)", () => {
    const chosen = chooseDayCodes([hours("2026-09-28", "pto", "req-2")], [dayCode("2026-09-28", SAL)], new Set(), [SAL]);
    expect(chosen.get("2026-09-28")).toEqual({ payCodeId: "pto", leaveRequestId: "req-2" });
  });

  it("chooses nothing on a day paid as the default, so the rule set's code applies", () => {
    expect(chooseDayCodes([hours("2026-10-01", SAL)], [], new Set(), [SAL]).size).toBe(0);
  });

  it("leaves days somebody clocked in on to their punches", () => {
    expect(chooseDayCodes([hours("2026-10-07", "pto")], [dayCode("2026-10-07", "pto")], new Set(["2026-10-07"]), [SAL]).size).toBe(0);
  });

  it("does not read hours from punches as salary hours", () => {
    const fromPunch = { segmentDate: day("2026-10-08"), startTime: new Date("2026-10-08T13:00:00.000Z"), payCodeId: "pto", leaveRequestId: null };
    expect(chooseDayCodes([fromPunch], [], new Set(), [SAL]).size).toBe(0);
  });
});
