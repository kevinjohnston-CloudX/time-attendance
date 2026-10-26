import { describe, expect, it } from "vitest";
import { payrollLeaveEntrySchema } from "./timecard-entry.schema";

const entry = (hours: number) => ({ timesheetId: "t", date: "2026-10-12", leaveTypeId: "lt-pto", durationMinutes: Math.round(hours * 60) });

describe("a leave line payroll enters on a timecard", () => {
  it("can be more than a day's 24 hours, as a PTO payout is (Estela Cuevas, 27.72 hours)", () => {
    expect(payrollLeaveEntrySchema.safeParse(entry(27.72)).success).toBe(true);
  });

  it("stops at 999 hours, to catch a slip such as 2772", () => {
    expect(payrollLeaveEntrySchema.safeParse(entry(999)).success).toBe(true);
    expect(payrollLeaveEntrySchema.safeParse(entry(2772)).success).toBe(false);
  });
});
