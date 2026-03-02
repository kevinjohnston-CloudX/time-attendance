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

export const timeclockScanSchema = z.object({
  EmployeeCode: z.string().min(1, "EmployeeCode is required"),
  ScanId: z.number().optional(),
  Warehouse: z.number().optional(),
  DepartmentName: z.string().optional(),
  ScanDateTime: z.string().min(1, "ScanDateTime is required"),
  DeviceName: z.string().optional(),
});

export type TimeclockScanInput = z.infer<typeof timeclockScanSchema>;
export type RecordPunchInput = z.infer<typeof recordPunchSchema>;
export type RequestMissedPunchInput = z.infer<typeof requestMissedPunchSchema>;
export type CorrectPunchInput = z.infer<typeof correctPunchSchema>;
