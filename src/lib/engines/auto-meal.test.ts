import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { applyAutoMealDeduction } from "./segment-builder";

// Times are UTC; the day key is read from segmentDate.
const day = new Date("2026-10-12T00:00:00.000Z");
const work = (from: string, to: string) => {
  const startTime = new Date(`2026-10-12T${from}:00.000Z`), endTime = new Date(`2026-10-12T${to}:00.000Z`);
  return { timesheetId: "t", segmentType: "WORK" as const, startTime, endTime, durationMinutes: (endTime.getTime() - startTime.getTime()) / 60_000, segmentDate: day, isPaid: true, payBucket: "REG" as const, isSplit: false };
};
const cfg = { mealBreakAfterMinutes: 360, mealBreakMinutes: 30, minMealMinutes: 1, maxMealMinutes: 60, disableMinDeduction: true };
const paid = (segs: ReturnType<typeof work>[]) => segs.filter((s) => s.segmentType === "WORK").reduce((n, s) => n + s.durationMinutes, 0);

describe("automatic meal with a lunch punched out and back in", () => {
  it("takes nothing more off when the lunch gap is inside the meal range (Madeleine De La Cruz, 10/12)", () => {
    const segs = [work("07:05", "11:15"), work("12:13", "15:34")];
    expect(paid(applyAutoMealDeduction(segs as never, cfg, new Set()) as never)).toBe(250 + 201); // 7.52 h, as NovaTime
  });

  it("still takes the meal off when there was no lunch", () => {
    const segs = [work("07:05", "15:34")];
    expect(paid(applyAutoMealDeduction(segs as never, cfg, new Set()) as never)).toBe(509 - 30);
  });

  it("still takes the meal off when the gap is longer than the meal range", () => {
    const segs = [work("07:00", "14:00"), work("15:30", "17:30")]; // 90 min off: not a meal
    expect(paid(applyAutoMealDeduction(segs as never, cfg, new Set()) as never)).toBe(540 - 30);
  });

  it("takes the rest of the meal off a short lunch when the shift deducts the full length", () => {
    const segs = [work("08:00", "12:00"), work("12:20", "16:30")];
    expect(paid(applyAutoMealDeduction(segs as never, { ...cfg, disableMinDeduction: false }, new Set()) as never)).toBe(240 + 250 - 10);
  });
});
