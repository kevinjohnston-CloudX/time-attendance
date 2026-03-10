import { z } from "zod";

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
]);

// ─── Report config (stored as JSON in DB) ───────────────────────────────────

export const reportConfigSchema = z.object({
  columns: z.array(z.string().min(1)).min(1),
  filters: z.array(filterDefSchema).default([]),
  groupBy: z.array(z.string()).default([]),
  sortBy: z.array(sortDefSchema).default([]),
  dateRange: dateRangeSchema,
  limit: z.number().int().min(1).max(10000).default(5000),
});

export type ReportConfig = z.infer<typeof reportConfigSchema>;
export type FilterDef = z.infer<typeof filterDefSchema>;
export type SortDef = z.infer<typeof sortDefSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;

// ─── Data sources ───────────────────────────────────────────────────────────

export const DATA_SOURCES = [
  "HOURS_SUMMARY",
  "ATTENDANCE_DETAIL",
  "LEAVE_SUMMARY",
  "LEAVE_BALANCE",
  "PUNCH_AUDIT",
  "EXCEPTION_REPORT",
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
  description: z.string().max(500).optional(),
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
  cronExpr: z
    .string()
    .regex(
      /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/,
      "Invalid cron expression"
    ),
  timezone: z.string().default("America/New_York"),
  format: z.enum(["CSV", "PDF", "XLSX"]).default("CSV"),
  recipients: z.array(z.string().email()).min(1).max(20),
});

// ─── Share ──────────────────────────────────────────────────────────────────

export const shareReportSchema = z.object({
  userId: z.string().min(1),
  canEdit: z.boolean().default(false),
});
