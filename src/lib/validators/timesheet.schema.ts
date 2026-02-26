import { z } from "zod";

export const timesheetIdSchema = z.object({
  timesheetId: z.string().cuid(),
});

export const rejectTimesheetSchema = z.object({
  timesheetId: z.string().cuid(),
  note: z.string().min(1, "A rejection note is required").max(500),
});

export type TimesheetIdInput = z.infer<typeof timesheetIdSchema>;
export type RejectTimesheetInput = z.infer<typeof rejectTimesheetSchema>;
