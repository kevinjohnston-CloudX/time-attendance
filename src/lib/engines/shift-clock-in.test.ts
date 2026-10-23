import { describe, expect, it } from "vitest";
import { openClockInOnDay, shiftClockIn, type ShiftPunch } from "./shift-clock-in";

const p = (id: string, punchType: string, iso: string): ShiftPunch => ({ id, punchType, roundedTime: new Date(iso) });
// Anali Galan: worked 9/21, 9:02 AM to 5:29 PM Eastern; Call Out on 9/22.
const anali = [p("in-21", "CLOCK_IN", "2026-09-21T13:02:00Z"), p("out-21", "CLOCK_OUT", "2026-09-21T21:29:00Z")];
const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe("the clock in a timecard line's pay code goes to", () => {
  it("is not the day before's for a leave line (her 9/22 Unpaid Time Off)", () => {
    const leave = { segmentType: "LEAVE", startTime: new Date("2026-09-22T09:00:00Z"), segmentDate: day("2026-09-22") };
    expect(shiftClockIn(leave, anali)).toBeNull();
  });

  it("is the shift's own for a worked line, after lunch included", () => {
    const afterLunch = { segmentType: "WORK", startTime: new Date("2026-09-21T19:32:00Z"), segmentDate: day("2026-09-21") };
    expect(shiftClockIn(afterLunch, anali)).toBe("in-21");
  });

  it("is the lunch return when lunch was punched", () => {
    const punched = [...anali.slice(0, 1), p("lunch-out", "CLOCK_OUT", "2026-09-21T17:00:00Z"), p("lunch-in", "CLOCK_IN", "2026-09-21T17:30:00Z"), anali[1]];
    expect(shiftClockIn({ segmentType: "WORK", startTime: new Date("2026-09-21T17:30:00Z"), segmentDate: day("2026-09-21") }, punched)).toBe("lunch-in");
  });

  it("is none for a worked line after the shift closed (a later day's hours)", () => {
    expect(shiftClockIn({ segmentType: "WORK", startTime: new Date("2026-09-22T13:00:00Z"), segmentDate: day("2026-09-22") }, anali)).toBeNull();
  });

  it("is none for salary or auto-pay hours from midnight", () => {
    expect(shiftClockIn({ segmentType: "WORK", startTime: day("2026-09-22"), segmentDate: day("2026-09-22") }, anali)).toBeNull();
  });
});

describe("a day's code set before its hours exist", () => {
  it("goes onto that day's clock in while it is still open", () => {
    expect(openClockInOnDay(day("2026-09-22"), [...anali, p("in-22", "CLOCK_IN", "2026-09-22T13:00:00Z")])).toBe("in-22");
  });
  it("leaves a closed shift's clock in alone", () => {
    expect(openClockInOnDay(day("2026-09-21"), anali)).toBeNull();
  });
});
