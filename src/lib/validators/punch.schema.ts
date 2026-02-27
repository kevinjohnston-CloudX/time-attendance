import { z } from "zod";
import { PunchType } from "@prisma/client";

export const recordPunchSchema = z.object({
  punchType: z.nativeEnum(PunchType),
  note: z.string().max(500).optional(),
});

export const requestMissedPunchSchema = z.object({
  punchType: z.nativeEnum(PunchType),
  punchTime: z.string().datetime({ offset: true }),
  note: z.string().min(1, "A note is required for missed punches").max(500),
});

export const correctPunchSchema = z.object({
  originalPunchId: z.string().cuid(),
  newPunchTime: z.string().datetime({ offset: true }),
  reason: z.string().min(1, "A reason is required").max(500),
});

export const approveMissedPunchSchema = z.object({
  punchId: z.string().cuid(),
});

export const timeclockPunchSchema = z.object({
  employeeCode: z.string().min(1),
  punchType: z.nativeEnum(PunchType),
  punchTime: z.string().datetime({ offset: true }),
  note: z.string().max(500).optional(),
});

export type TimeclockPunchInput = z.infer<typeof timeclockPunchSchema>;
export type RecordPunchInput = z.infer<typeof recordPunchSchema>;
export type RequestMissedPunchInput = z.infer<typeof requestMissedPunchSchema>;
export type CorrectPunchInput = z.infer<typeof correctPunchSchema>;
