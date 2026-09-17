import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd");

export const daySelectionSchema = z.discriminatedUnion("type", [
  z.object({ date: dateStr, type: z.literal("FULL") }),
  z.object({
    date: dateStr,
    type: z.literal("PARTIAL"),
    minutes: z.number().int().positive("Minutes must be positive").max(1440, "Minutes cannot exceed 24 hours"),
  }),
]);

export const requestLeaveSchema = z.object({
  leaveTypeId: z.string().min(1),
  selectedDays: z.array(daySelectionSchema).min(1, "Select at least one day"),
  note: z.string().optional(),
});

export const submitLeaveForEmployeeSchema = z.object({
  targetEmployeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  selectedDays: z.array(daySelectionSchema).min(1, "Select at least one day"),
  note: z.string().optional(),
});

export type SubmitLeaveForEmployeeInput = z.infer<typeof submitLeaveForEmployeeSchema>;

export const leaveRequestIdSchema = z.object({
  leaveRequestId: z.string().min(1),
});

export const reviewLeaveSchema = z.object({
  leaveRequestId: z.string().min(1),
  reviewNote: z.string().optional(),
});

export type DaySelectionInput = z.infer<typeof daySelectionSchema>;
export type RequestLeaveInput = z.infer<typeof requestLeaveSchema>;
export type LeaveRequestIdInput = z.infer<typeof leaveRequestIdSchema>;
export type ReviewLeaveInput = z.infer<typeof reviewLeaveSchema>;
