import { z } from "zod";

export const resolveExceptionSchema = z.object({
  exceptionId: z.string().min(1),
  resolution: z.string().min(1, "Resolution note is required"),
});

export const addMissingPunchSchema = z.object({
  timesheetId: z.string().min(1),
  exceptionId: z.string().min(1),
  punchType: z.enum([
    "CLOCK_IN", "MEAL_START", "MEAL_END",
    "CLOCK_OUT", "BREAK_START", "BREAK_END",
  ]),
  punchTime: z.string().min(1),
  reason: z.string().min(1, "Reason is required"),
});

export const correctAndResolveSchema = z.object({
  originalPunchId: z.string().min(1),
  newPunchTime: z.string().min(1),
  reason: z.string().min(1, "Reason is required"),
  exceptionId: z.string().min(1),
});

export type ResolveExceptionInput = z.infer<typeof resolveExceptionSchema>;
export type AddMissingPunchInput = z.infer<typeof addMissingPunchSchema>;
export type CorrectAndResolveInput = z.infer<typeof correctAndResolveSchema>;
