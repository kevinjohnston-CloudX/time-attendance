import { z } from "zod";

export const timesheetIdSchema = z.object({
  timesheetId: z.string().cuid(),
});

export type TimesheetIdInput = z.infer<typeof timesheetIdSchema>;
