import { z } from "zod";

export const requestLeaveSchema = z.object({
  leaveTypeId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd"),
  durationMinutes: z.number().int().positive("Duration must be positive"),
  note: z.string().optional(),
});

export const leaveRequestIdSchema = z.object({
  leaveRequestId: z.string().min(1),
});

export const reviewLeaveSchema = z.object({
  leaveRequestId: z.string().min(1),
  reviewNote: z.string().optional(),
});

export type RequestLeaveInput = z.infer<typeof requestLeaveSchema>;
export type LeaveRequestIdInput = z.infer<typeof leaveRequestIdSchema>;
export type ReviewLeaveInput = z.infer<typeof reviewLeaveSchema>;
