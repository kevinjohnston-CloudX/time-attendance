import { z } from "zod";

export const manualPunchPairSchema = z.object({
  timesheetId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-MM-dd"),
  inTime: z.string().datetime({ offset: true }),
  outTime: z.string().datetime({ offset: true }),
  reason: z.string().min(1, "Reason is required").max(500),
  payBucketOverride: z.string().optional(),
});

export type ManualPunchPairInput = z.infer<typeof manualPunchPairSchema>;

export const singleManualPunchSchema = z.object({
  timesheetId: z.string().min(1),
  punchType: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  punchTime: z.string().datetime({ offset: true }),
  reason: z.string().min(1, "Reason is required").max(500),
});

export type SingleManualPunchInput = z.infer<typeof singleManualPunchSchema>;

export const payrollLeaveEntrySchema = z.object({
  timesheetId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be yyyy-MM-dd"),
  leaveTypeId: z.string().min(1),
  durationMinutes: z.number().int().min(1).max(1440),
  note: z.string().max(500).optional(),
});

export type PayrollLeaveEntryInput = z.infer<typeof payrollLeaveEntrySchema>;
