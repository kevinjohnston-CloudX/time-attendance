import { describe, expect, it } from "vitest";
import { roundedHoursNote } from "./hours-entry";

describe("Hours typed by hand", () => {
  it("are kept as typed when they land on a whole minute", () => {
    for (const v of ["7.75", "7.8", "8", "0.05", "7.5"]) expect(roundedHoursNote(v)).toBeNull();
  });
  it("say what they are saved as when they fall between two minutes (HR's 7.76)", () => {
    expect(roundedHoursNote("7.76")).toMatch(/^As worked hours this saves as 7\.77/);
    expect(roundedHoursNote("0.01")).toMatch(/^As worked hours this saves as 0\.02/);
  });
  it("say that a leave code keeps them as typed (HR's 0.56 PTO payout)", () => {
    expect(roundedHoursNote("0.56")).toBe("As worked hours this saves as 0.57: worked time is kept to the minute. Under a leave code such as PTO it stays 0.56.");
  });
  it("say nothing when the minute it lands on still reads the same (7.88 is 473 minutes, 7.88)", () => {
    expect(roundedHoursNote("7.88")).toBeNull();
  });
  it("say nothing while the field is empty or zero", () => {
    expect(roundedHoursNote("")).toBeNull();
    expect(roundedHoursNote("0")).toBeNull();
  });
});
