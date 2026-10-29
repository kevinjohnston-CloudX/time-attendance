import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { isMealLockoutRejection, mealLockoutRejection, mealLockoutWait } from "./punch-helpers";

const pt = (hms: string) => new Date(`2026-10-28T${hms}-07:00`);

describe("mealLockoutWait", () => {
  it("refuses a clock in under 30 clock minutes, with the minutes left, as Oracle did on 10/28", () => {
    expect(mealLockoutWait(pt("11:40:55"), pt("12:03:30"), 30)).toBe(7); // Krystle Brewster
    expect(mealLockoutWait(pt("11:48:26"), pt("12:16:57"), 30)).toBe(2); // Silvia Munoz
    expect(mealLockoutWait(pt("12:37:12"), pt("13:06:54"), 30)).toBe(1); // Ana Marquez, 29m 42s
  });

  it("lets through 30 clock minutes, even a few seconds short of 30 by the second", () => {
    expect(mealLockoutWait(pt("12:55:59"), pt("13:25:37"), 30)).toBe(0); // Ubaldo Lopez Graciano, 29m 38s
    expect(mealLockoutWait(pt("12:00:00"), pt("12:30:00"), 30)).toBe(0);
    expect(mealLockoutWait(pt("12:00:00"), pt("13:15:00"), 30)).toBe(0);
  });

  it("does nothing when the rule set has no lockout", () => {
    expect(mealLockoutWait(pt("11:40:55"), pt("12:03:30"), 0)).toBe(0);
  });
});

describe("meal lockout refusal", () => {
  it("is worded as Oracle's, and is recognised", () => {
    expect(mealLockoutRejection(7)).toBe("Please wait 7 minutes before clocking in again.");
    expect(mealLockoutRejection(1)).toBe("Please wait 1 minute before clocking in again.");
    expect(isMealLockoutRejection(mealLockoutRejection(1))).toBe(true);
    expect(isMealLockoutRejection(mealLockoutRejection(12))).toBe(true);
    expect(isMealLockoutRejection("Scanned again too quickly, please wait to prevent duplicates")).toBe(false);
    expect(isMealLockoutRejection(null)).toBe(false);
  });
});
