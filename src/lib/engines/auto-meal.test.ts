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

  it("takes the meal off where 6 hours worked is reached, after a long lunch (Arianna Garcia Vazquez, 10/19)", () => {
    // 8:01 to 1:02 and 2:10 to 5:06 Eastern: 68 min off is not a meal, and 6
    // hours worked comes at 3:09, in the afternoon. NovaTime paid 7.45.
    const segs = [work("12:01", "17:02"), work("18:10", "21:06")];
    const out = applyAutoMealDeduction(segs as never, cfg, new Set()) as never as { segmentType: string; startTime: Date; endTime: Date }[];
    expect(paid(out as never)).toBe(301 + 176 - 30);
    expect(out.find((s) => s.segmentType === "MEAL")?.startTime.toISOString()).toBe("2026-10-12T19:09:00.000Z");
  });

  it("does the same after a lunch of over two hours (Tiffany Barton, 10/19)", () => {
    const segs = [work("11:30", "16:05"), work("18:20", "22:05")];
    expect(paid(applyAutoMealDeduction(segs as never, cfg, new Set()) as never)).toBe(275 + 225 - 30); // 7.83 h, as NovaTime
  });

  it("still ends the meal at the clock out when 6 hours comes just before it (Michelle Avila, 10/19)", () => {
    const segs = [work("11:59", "18:04"), work("19:05", "21:02")];
    const out = applyAutoMealDeduction(segs as never, cfg, new Set()) as never as { segmentType: string; startTime: Date; endTime: Date }[];
    expect(paid(out as never)).toBe(365 + 117 - 30); // 7.53 h, as NovaTime
    expect(out.find((s) => s.segmentType === "MEAL")?.endTime.toISOString()).toBe("2026-10-12T18:04:00.000Z");
  });

  it("takes the meal off exactly 6 hours worked, as 'work at least 6 hours' reads (Milagros Mogollon, 9/30)", () => {
    // 8:35 to 2:35 Eastern, no lunch: NovaTime paid 5.5.
    expect(paid(applyAutoMealDeduction([work("12:35", "18:35")] as never, cfg, new Set()) as never)).toBe(360 - 30);
  });

  it("takes nothing off a minute short of 6 hours", () => {
    expect(paid(applyAutoMealDeduction([work("12:35", "18:34")] as never, cfg, new Set()) as never)).toBe(359);
  });

  it("does not count a break over an hour as the meal (Yamilex Larrea, 10/2: 75 minutes off)", () => {
    // 8:53 to 12:51 and 2:07 to 5:31 Eastern: NovaTime still took its 30 minutes, 6.87 h paid.
    const segs = [work("12:53", "16:51"), work("18:07", "21:31")];
    expect(paid(applyAutoMealDeduction(segs as never, { ...cfg, minMealMinutes: 15, maxMealMinutes: 60 }, new Set()) as never)).toBe(238 + 204 - 30);
  });

  it("takes the rest of the meal off a short lunch when the shift deducts the full length", () => {
    const segs = [work("08:00", "12:00"), work("12:20", "16:30")];
    expect(paid(applyAutoMealDeduction(segs as never, { ...cfg, disableMinDeduction: false }, new Set()) as never)).toBe(240 + 250 - 10);
  });
});
