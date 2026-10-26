import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { hoursToSeconds, secondsToHours, secondsToMinutes } from "./leave-time";
import { computeRate } from "./engines/accrual-engine";

describe("leave kept to the hundredth of an hour", () => {
  it("holds NovaTime's hours exactly, where whole minutes rounded them", () => {
    expect(hoursToSeconds(0.56)).toBe(2016); // a PTO payout: was 34 minutes, 0.57
    expect(hoursToSeconds(6.16)).toBe(22176); // an accrual: was 370 minutes, 6.17
    expect(hoursToSeconds(27.72)).toBe(99792);
    expect(secondsToHours(2016)).toBe(0.56);
    expect(secondsToHours(22176)).toBe(6.16);
  });

  it("still shows whole minutes, for the hours and minutes display", () => {
    expect(secondsToMinutes(2016)).toBe(34);
    expect(secondsToMinutes(28800)).toBe(480);
  });
});

describe("an accrual posting", () => {
  it("posts the policy's hours to the hundredth, so a year of them adds up as in NovaTime", () => {
    const rate = computeRate("BI_WEEKLY", "PER_POSTING", 6.16, 26);
    expect(rate).toBe(22176);
    expect(secondsToHours(rate * 26)).toBe(160.16); // whole minutes made it 160.33
  });

  it("rounds a yearly amount split over the postings to the hundredth, as NovaTime does", () => {
    // 160 hours over 26 postings is 6.1538 hours: NovaTime posts 6.15.
    expect(computeRate("BI_WEEKLY", "YEARLY", 160, 26)).toBe(hoursToSeconds(6.15));
  });
});
