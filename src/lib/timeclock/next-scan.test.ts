import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PunchState } from "@prisma/client";

/**
 * Whether a time clock scan right now would be a clock out, read the way the
 * punch endpoint classifies it (api/timeclock/punch/route.ts, steps 7 and 8).
 * The tablet check sets the security rule aside for exactly these scans.
 */

const state = vi.hoisted(() => ({
  punchState: "OUT" as PunchState,
  open: null as null | { punchTime: Date; timesheetId: string | null },
}));

vi.mock("@/lib/utils/punch-helpers", () => ({ getCurrentPunchState: async () => state.punchState }));
vi.mock("@/lib/db", () => ({ db: { punch: { findFirst: async () => state.open } } }));

import { nextScanClocksOut } from "./next-scan";

/** Gabriel's setup at 5903 Nj: a 8:30 AM to 5:00 PM shift, two hours of expansion. */
const person = (over: Partial<Parameters<typeof nextScanClocksOut>[0]> = {}) => ({
  id: "e1",
  timeZone: null,
  site: { timezone: "America/New_York" },
  ruleSet: { workdayExpansionEnabled: true, workdayExpansionUseShiftDef: true, workdayExpansionAfterMinutes: 120 },
  shift: { startTime: "08:30", endTime: "17:00" },
  ...over,
});

/** A New York wall clock time on a November 2026 day (EST, UTC minus 5). */
const ny = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 10, day, hh + 5, mm));

beforeEach(() => {
  state.punchState = "OUT";
  state.open = null;
});

describe("nextScanClocksOut", () => {
  it("is a clock in for someone clocked out", async () => {
    expect(await nextScanClocksOut(person(), ny(25, 8))).toBe(false);
  });

  it("is coming back in for someone on a meal or a break", async () => {
    for (const s of ["MEAL", "BREAK"] as const) {
      state.punchState = s;
      expect(await nextScanClocksOut(person(), ny(25, 13))).toBe(false);
    }
  });

  it("is a clock out at the end of the shift (ticket 81278)", async () => {
    state.punchState = "WORK";
    state.open = { punchTime: ny(25, 7, 55), timesheetId: "t1" };
    expect(await nextScanClocksOut(person(), ny(25, 17, 6))).toBe(true);
  });

  it("is a clock out on a long day, past the shift and its window", async () => {
    state.punchState = "WORK";
    state.open = { punchTime: ny(25, 7, 55), timesheetId: "t1" };
    expect(await nextScanClocksOut(person(), ny(25, 21, 30))).toBe(true);
  });

  it("is a clock in the morning after a forgotten clock out", async () => {
    state.punchState = "WORK";
    state.open = { punchTime: ny(24, 7, 49), timesheetId: "t1" };
    expect(await nextScanClocksOut(person(), ny(25, 7, 55))).toBe(false);
  });

  it("without a shift to measure by, is a clock in on a new day and a clock out the same day", async () => {
    state.punchState = "WORK";
    const noShift = person({ shift: null });
    state.open = { punchTime: ny(24, 9), timesheetId: "t1" };
    expect(await nextScanClocksOut(noShift, ny(25, 8))).toBe(false);
    state.open = { punchTime: ny(25, 9), timesheetId: "t1" };
    expect(await nextScanClocksOut(noShift, ny(25, 17))).toBe(true);
  });

  it("is a clock out whenever workday expansion is off, as the punch endpoint reads it", async () => {
    state.punchState = "WORK";
    state.open = { punchTime: ny(24, 9), timesheetId: "t1" };
    const off = person({ ruleSet: { workdayExpansionEnabled: false, workdayExpansionUseShiftDef: true, workdayExpansionAfterMinutes: 120 } });
    expect(await nextScanClocksOut(off, ny(25, 8))).toBe(true);
  });

  it("is a clock out when the open punch is on no timecard, which the punch endpoint does not re-read", async () => {
    state.punchState = "WORK";
    state.open = { punchTime: ny(24, 9), timesheetId: null };
    expect(await nextScanClocksOut(person(), ny(25, 8))).toBe(true);
  });
});
