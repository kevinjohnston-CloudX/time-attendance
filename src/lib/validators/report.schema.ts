import { z } from "zod";
import { isKnownTimeZone, parseSchedule } from "@/lib/reports/schedule-time";

// ─── Filter definition ──────────────────────────────────────────────────────

export const filterOperatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "notIn",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
  // A date that falls in the report's own dates, so a saved "hired in these
  // dates" moves with them. Only the Employees report offers it.
  "inRange",
]);

export const filterDefSchema = z.object({
  field: z.string().min(1),
  operator: filterOperatorSchema,
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
  ]),
  value2: z.union([z.string(), z.number()]).optional(), // for "between"
});

// ─── Sort definition ────────────────────────────────────────────────────────

export const sortDefSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
});

// ─── Date range definition ──────────────────────────────────────────────────

export const dateRangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("payPeriod"),
    payPeriodId: z.string().min(1),
    // Every pay group with a pay period inside these dates, not just this
    // one's group. Absent on reports saved before it existed, which keep
    // their one pay period.
    allGroups: z.boolean().optional(),
    // "Always the current (or previous) pay period": the pay period above
    // only says which pay group to follow, and the one running on the day the
    // report runs is used (see moving-period.ts). Absent: that one period.
    moving: z.enum(["current", "previous"]).optional(),
  }),
  z.object({
    type: z.literal("custom"),
    startDate: z.string().min(1), // ISO date string
    endDate: z.string().min(1),
  }),
  z.object({
    type: z.literal("relative"),
    relativeDays: z.number().int().min(1).max(365),
  }),
  z.object({ type: z.literal("today") }),
  z.object({ type: z.literal("yesterday") }),
  // A whole calendar week, month or year, this one or the last one, worked
  // out when the report runs, so a saved report keeps meaning "last month"
  // every month. Weeks start on the company's day (see tenantWeekStart).
  z.object({
    type: z.literal("calendar"),
    unit: z.enum(["week", "month", "year"]),
    which: z.enum(["this", "last"]),
  }),
]);

// ─── Report config (stored as JSON in DB) ───────────────────────────────────

// ─── Print layout ───────────────────────────────────────────────────────────

/**
 * How a report prints: a new page for each group of one grouped field (a
 * timesheet per employee), and a statement with signature lines under each
 * page group, or once under the report. Absent on reports saved before it.
 */
export const printLayoutSchema = z.object({
  pageBreak: z.string().min(1).max(64).optional(),
  // Each row drawn as a card, its columns one under another, like a profile.
  cards: z.boolean().optional(),
  signature: z
    .object({
      text: z.string().trim().max(600),
      employee: z.boolean(),
      supervisor: z.boolean(),
    })
    .optional(),
});

export const reportConfigSchema = z.object({
  columns: z.array(z.string().min(1)).min(1),
  filters: z.array(filterDefSchema).default([]),
  groupBy: z.array(z.string()).default([]),
  sortBy: z.array(sortDefSchema).default([]),
  dateRange: dateRangeSchema,
  limit: z.number().int().min(1).max(50000).default(5000),
  layout: printLayoutSchema.optional(),
  // One field spread across the columns, each holding a number added up:
  // a column for each day of the week, date or pay code.
  across: z.object({ field: z.string().min(1).max(64), value: z.string().min(1).max(64) }).optional(),
});

export type ReportConfig = z.infer<typeof reportConfigSchema>;
export type FilterDef = z.infer<typeof filterDefSchema>;
export type SortDef = z.infer<typeof sortDefSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;

// ─── Data sources ───────────────────────────────────────────────────────────

export const DATA_SOURCES = [
  "HOURS_SUMMARY",
  "ATTENDANCE_DETAIL",
  "DAILY_HOURS",
  "LEAVE_SUMMARY",
  "LEAVE_BALANCE",
  "PUNCH_AUDIT",
  "EXCEPTION_REPORT",
  "SECURITY_SCAN",
  "TIME_CLOCK_SCAN",
  "EMPLOYEES",
  "LABOR_COST",
  "TIMESHEET_NOTES",
  "TIME_OFF_HISTORY",
  "TIME_OFF_SUMMARY",
  "SCHEDULED_HOURS",
  "SCANS_NOT_RECORDED",
  "HOURS_TO_DATE",
  "WEEKLY_OVERTIME",
  "ATTENDANCE_SUMMARY",
] as const;

export type DataSourceId = (typeof DATA_SOURCES)[number];

export const dataSourceSchema = z.enum(DATA_SOURCES);

// ─── Create / update report ─────────────────────────────────────────────────

export const createReportSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  dataSource: dataSourceSchema,
  config: reportConfigSchema,
  folderId: z.string().optional(),
  visibility: z.enum(["PRIVATE", "SHARED", "TENANT"]).default("PRIVATE"),
});

export const updateReportSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  /** An empty string clears it. */
  description: z.string().max(500).optional(),
  dataSource: dataSourceSchema.optional(),
  config: reportConfigSchema.optional(),
  folderId: z.string().nullable().optional(),
  visibility: z.enum(["PRIVATE", "SHARED", "TENANT"]).optional(),
});

// ─── Folder ─────────────────────────────────────────────────────────────────

export const createFolderSchema = z.object({
  name: z.string().min(1).max(50),
  parentId: z.string().optional(),
});

export const renameFolderSchema = z.object({
  name: z.string().min(1).max(50),
});

// ─── Schedule ───────────────────────────────────────────────────────────────

export const reportScheduleSchema = z.object({
  reportId: z.string().min(1),
  // Five values. The day of the month may also be L, the last day of the
  // month, which plain cron cannot say.
  cronExpr: z
    .string()
    .regex(
      /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+|[0-9,L\-\/]*L[0-9,L\-\/]*)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/,
      "Invalid cron expression"
    )
    .refine((v) => {
      try {
        parseSchedule(v);
        return true;
      } catch {
        return false;
      }
    }, "Invalid cron expression"),
  timezone: z.string().refine(isKnownTimeZone, "Unknown time zone").default("America/New_York"),
  format: z.enum(["CSV", "PDF", "XLSX"]).default("CSV"),
  recipients: z.array(z.string().email()).min(1).max(20),
});

// ─── Share ──────────────────────────────────────────────────────────────────

export const shareReportSchema = z.object({
  userId: z.string().min(1),
  canEdit: z.boolean().default(false),
});
