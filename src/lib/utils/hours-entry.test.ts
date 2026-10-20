import { describe, expect, it } from "vitest";
import { roundedHoursNote } from "./hours-entry";

describe("Hours typed by hand", () => {
  it("are kept as typed when they land on a whole minute", () => {
    for (const v of ["7.75", "7.8", "8", "0.05", "7.5"]) expect(roundedHoursNote(v)).toBeNull();
  });
  it("say what they are saved as when they fall between two minutes (HR's 7.76)", () => {
    expect(roundedHoursNote("7.76")).toMatch(/^Saved as 7\.77 hours/);
    expect(roundedHoursNote("0.01")).toMatch(/^Saved as 0\.02 hours/);
  });
  it("say nothing when the minute it lands on still reads the same (7.88 is 473 minutes, 7.88)", () => {
    expect(roundedHoursNote("7.88")).toBeNull();
  });
  it("say nothing while the field is empty or zero", () => {
    expect(roundedHoursNote("")).toBeNull();
    expect(roundedHoursNote("0")).toBeNull();
  });
});
