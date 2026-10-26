import { z } from "zod";

export const manualPunchPairSchema = z.object({
  timesheetId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-MM-dd"),
  inTime: z.string().datetime({ offset: true }),
  outTime: z.string().datetime({ offset: true }),
  reason: z.string().min(1, "Reason is required").max(500),
  payBucketOverride: z.string().optional(),
  payCodeId: z.string().optional(),
});

export type ManualPunchPairInput = z.infer<typeof manualPunchPairSchema>;

export const singleManualPunchSchema = z.object({
  timesheetId: z.string().min(1),
  punchType: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  punchTime: z.string().datetime({ offset: true }),
  reason: z.string().max(500).optional(),
});

export type SingleManualPunchInput = z.infer<typeof singleManualPunchSchema>;

export const payrollLeaveEntrySchema = z.object({
  timesheetId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-MM-dd"),
  leaveTypeId: z.string().min(1),
  // In hours, kept to the hundredth (lib/leave-time). More than a day's 24
  // hours is allowed: payroll enters a PTO payout or carryover here as one
  // line (27.72 hours on one day).
  hours: z.number().min(0.01, "Enter at least 0.01 hours").max(999, "Enter at most 999 hours"),
  note: z.string().max(500).optional(),
});

export type PayrollLeaveEntryInput = z.infer<typeof payrollLeaveEntrySchema>;
