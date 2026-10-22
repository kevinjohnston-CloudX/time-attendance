import type { ReportConfig, DataSourceId } from "@/lib/validators/report.schema";
import type { FieldMap } from "../query-builder";
import { hoursSummarySource } from "./hours-summary";
import { attendanceDetailSource } from "./attendance-detail";
import { dailyHoursSource } from "./daily-hours";
import { leaveSummarySource } from "./leave-summary";
import { leaveBalanceSource } from "./leave-balance";
import { punchAuditSource } from "./punch-audit";
import { exceptionReportSource } from "./exception-report";
import { securityScanSource, timeClockScanSource } from "./scan-report";
import { employeesSource } from "./employees";
import { laborCostSource } from "./labor-cost";
import { daysOf, REPORT_ZONE, todayIn } from "../period";
import { spreadAcross } from "../across";
import { groupRows, type ReportGroups } from "../grouping";
import { resolveMovingPayPeriod, tenantWeekStart } from "../moving-period";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ColumnDef {
  id: string;
  label: string;
  type: "string" | "number" | "date" | "boolean";
  /** Default selected when creating a new report */
  defaultVisible?: boolean;
  /** The heading in a CSV or Excel download, when it differs from the screen's. */
  exportLabel?: string;
  /** Adds up in group totals and the grand total. Hours columns always do. */
  total?: boolean;
  /** Groups on this column are ordered by this other row field (a week by its first day). */
  groupOrder?: string;
  /** Can be spread across the columns, one column for each of its values (see across.ts). */
  across?: boolean;
}

export interface FilterFieldDef {
  id: string;
  label: string;
  type: "string" | "number" | "date" | "boolean";
  /** Allowed operators for this field */
  operators: string[];
  /** If the field has a fixed set of values, provide them for a dropdown */
  options?: { value: string; label: string }[];
}

export interface ReportResult {
  columns: { id: string; label: string; type: string; exportLabel?: string; total?: boolean }[];
  /** Rows were combined from a report that stopped at its limit, so they are short. */
  truncated?: boolean;
  rows: Record<string, unknown>[];
  totalRows: number;
  /** The days the rows cover, for reports that work them out themselves. */
  period?: { start: string; end: string; label: string };
  /** The rows in their groups, with totals; `rows` are already in group order. */
  groups?: ReportGroups;
}

/** What a run needs to know besides the report: where "yesterday" is, and when "now" is. */
export interface ExecuteContext {
  /** The time zone dates like "yesterday" and "last month" are read in. */
  timezone?: string;
  now?: Date;
}

export interface DataSourceDefinition {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string; // Lucide icon name
  /** Put in front of the file's name, so a file says which product made it. */
  brand?: string;
  columns: ColumnDef[];
  filters: FilterFieldDef[];
  groupableFields: string[];
  fieldMap: FieldMap;
  execute: (
    config: ReportConfig,
    tenantId: string,
    ctx?: ExecuteContext
  ) => Promise<ReportResult>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const sources: Record<DataSourceId, DataSourceDefinition> = {
  HOURS_SUMMARY: hoursSummarySource,
  ATTENDANCE_DETAIL: attendanceDetailSource,
  DAILY_HOURS: dailyHoursSource,
  LEAVE_SUMMARY: leaveSummarySource,
  LEAVE_BALANCE: leaveBalanceSource,
  PUNCH_AUDIT: punchAuditSource,
  EXCEPTION_REPORT: exceptionReportSource,
  SECURITY_SCAN: securityScanSource,
  TIME_CLOCK_SCAN: timeClockScanSource,
  EMPLOYEES: employeesSource,
  LABOR_COST: laborCostSource,
};

/**
 * "This month" and "last week" are worked out when a report runs, so a saved
 * report keeps meaning the month just gone. Every report reads plain dates, so
 * the period is turned into them here, in one place, before the report sees it.
 */
function withCalendarDates(def: DataSourceDefinition): DataSourceDefinition {
  return {
    ...def,
    execute: async (config, tenantId, ctx) => {
      const range = config.dateRange;
      // "Always the current pay period": the one running today, in the saved
      // period's pay group.
      if (range.type === "payPeriod" && range.moving) {
        const today = todayIn(ctx?.timezone ?? REPORT_ZONE, ctx?.now);
        const resolved = await resolveMovingPayPeriod(range, tenantId, today);
        return def.execute({ ...config, dateRange: resolved }, tenantId, ctx);
      }
      if (range.type !== "calendar") return def.execute(config, tenantId, ctx);
      const weekStart = range.unit === "week" ? await tenantWeekStart(tenantId) : 1;
      const { start, end } = daysOf(range, ctx?.timezone, ctx?.now, weekStart);
      return def.execute({ ...config, dateRange: { type: "custom", startDate: start, endDate: end } }, tenantId, ctx);
    },
  };
}

/**
 * Groups and totals, added to every report after it runs (see grouping.ts),
 * so the screen and every download read the same lines. A report that came
 * back with exactly its row limit is taken as cut short, and draws no totals.
 */
function withGroups(def: DataSourceDefinition): DataSourceDefinition {
  return {
    ...def,
    execute: async (config, tenantId, ctx) => {
      const groupBy = (config.groupBy ?? []).filter((id) => def.groupableFields.includes(id));
      // Rows come back in group order before the row limit cuts them, so a
      // preview of 100 shows whole groups (a timesheet with all its days)
      // rather than the first day of everyone.
      const groupSort = groupBy
        .filter((id) => !config.sortBy.some((s) => s.field === id))
        .map((field) => ({ field, direction: "asc" as const }));
      const result = await def.execute({ ...config, sortBy: [...groupSort, ...config.sortBy] }, tenantId, ctx);
      const totalOf = new Map(def.columns.map((c) => [c.id, c.total]));
      const grouped = groupRows(
        result.rows,
        result.columns.map((c) => ({ ...c, total: c.total ?? totalOf.get(c.id) })),
        groupBy,
        {
          complete: !result.truncated && !(config.limit && result.rows.length >= config.limit),
          fieldLabels: Object.fromEntries(def.columns.map((c) => [c.id, c.label])),
          groupOrder: Object.fromEntries(def.columns.filter((c) => c.groupOrder).map((c) => [c.id, c.groupOrder!])),
          layout: config.layout,
        }
      );
      return grouped ? { ...result, rows: grouped.rows, groups: grouped.groups } : result;
    },
  };
}

/** How many lines a report spread across columns may read before it is combined. */
export const ACROSS_SOURCE_ROWS = 50000;

/**
 * A field spread across the columns (see across.ts). The report runs in full
 * and is combined afterwards, so the row limit applies to the combined rows:
 * a preview of 100 lines would otherwise combine into a handful of short ones.
 */
function withAcross(def: DataSourceDefinition): DataSourceDefinition {
  return {
    ...def,
    execute: async (config, tenantId, ctx) => {
      const spec = config.across;
      const ok =
        spec &&
        def.columns.some((c) => c.id === spec.field && c.across) &&
        def.columns.some((c) => c.id === spec.value && c.type === "number");
      if (!ok) return def.execute(config, tenantId, ctx);
      const result = await def.execute({ ...config, limit: ACROSS_SOURCE_ROWS }, tenantId, ctx);
      const spread = spreadAcross(result, def.columns, spec);
      if (!spread) return result;
      const rows = config.limit ? spread.rows.slice(0, config.limit) : spread.rows;
      return {
        ...result,
        columns: spread.columns,
        rows,
        totalRows: spread.rows.length,
        truncated: result.rows.length >= ACROSS_SOURCE_ROWS || rows.length < spread.rows.length,
      };
    },
  };
}

const dataSources = Object.fromEntries(
  Object.entries(sources).map(([id, def]) => [id, withGroups(withAcross(withCalendarDates(def)))])
) as Record<DataSourceId, DataSourceDefinition>;

export function getDataSource(id: DataSourceId): DataSourceDefinition {
  const source = dataSources[id];
  if (!source) throw new Error(`Unknown data source: ${id}`);
  return source;
}

export function getAllDataSources(): DataSourceDefinition[] {
  return Object.values(dataSources);
}
