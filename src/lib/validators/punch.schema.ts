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
  reason: z.string().max(500).optional(),
});

export const approveMissedPunchSchema = z.object({
  punchId: z.string().cuid(),
});

export const timeclockScanSchema = z.object({
  EmployeeCode: z.string().min(1, "EmployeeCode is required"),
  ScanId: z.number().optional(),
  // Text, not number: the time clocks report NJ299 / NJ3 / CA2 / GA7575 / CAN
  // while the gates report numeric location ids. A numeric field could only
  // ever accept the gates, and silently dropped every clock location.
  Warehouse: z.union([z.string(), z.number()]).optional(),
  DepartmentName: z.string().optional(),
  ScanDateTime: z.string().min(1, "ScanDateTime is required"),
  DeviceName: z.string().optional(),
  /// The kiosk build that recorded this, so a scan can be traced to a version
  /// without anyone standing in front of the tablet. Bounded because it lands
  /// in a column and comes from a client.
  AppVersion: z.string().max(32).optional(),
});

/**
 * Payload for the unified kiosk scan endpoint. Mirrors timeclockScanSchema's
 * PascalCase so the Android client can build one body shape for both flows,
 * and adds the two fields that endpoint needs:
 *
 *   Stream         — which kiosk flow this came from. Required: the two streams
 *                    resolve direction differently and must never be conflated.
 *   LegacyScanType — what cajaapi reported, recorded for reconciliation only.
 *                    Never used to decide the stored direction.
 */
export const kioskScanSchema = z.object({
  EmployeeCode: z.string().min(1, "EmployeeCode is required"),
  ScanDateTime: z.string().min(1, "ScanDateTime is required"),
  Stream: z.enum(["TIME_CLOCK", "SECURITY"]),
  DeviceName: z.string().optional(),
  Warehouse: z.union([z.string(), z.number()]).optional(),
  LegacyScanType: z.string().optional(),
  /// The kiosk build that recorded this. See timeclockScanSchema.
  AppVersion: z.string().max(32).optional(),
});

/**
 * What a tablet reports about its conversation with Oracle.
 *
 * Every field but the badge, the kind, the outcome and the time is optional:
 * this is diagnostic data from a fleet that includes builds nobody will ever
 * update again, and a report that arrives incomplete is worth more than one
 * rejected for being incomplete.
 */
export const legacySyncReportSchema = z.object({
  EmployeeCode: z.string().min(1, "EmployeeCode is required"),
  Kind: z.enum(["PUNCH", "GATE_SCAN", "CAPTURE"]),
  Outcome: z.enum(["SUCCESS", "REFUSED", "RETRYING", "FAILED_PERMANENT"]),
  ScanDateTime: z.string().min(1, "ScanDateTime is required"),
  Endpoint: z.string().max(200).optional(),
  /// Oracle's own words. Bounded because it lands in a column and the legacy
  /// API has been known to return a stack trace.
  Message: z.string().max(500).optional(),
  AttemptCount: z.number().int().min(1).max(1000).optional(),
  /// The tablet's local queue row id, which the device log uses too.
  QueueRowId: z.number().int().optional(),
  DeviceName: z.string().max(100).optional(),
  AppVersion: z.string().max(32).optional(),
});

export type KioskScanInput = z.infer<typeof kioskScanSchema>;
export type LegacySyncReportInput = z.infer<typeof legacySyncReportSchema>;

export type TimeclockScanInput = z.infer<typeof timeclockScanSchema>;
export type RecordPunchInput = z.infer<typeof recordPunchSchema>;
export type RequestMissedPunchInput = z.infer<typeof requestMissedPunchSchema>;
export type CorrectPunchInput = z.infer<typeof correctPunchSchema>;
