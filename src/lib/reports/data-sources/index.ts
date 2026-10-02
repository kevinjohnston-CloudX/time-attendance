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
import { daysOf } from "../period";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ColumnDef {
  id: string;
  label: string;
  type: "string" | "number" | "date" | "boolean";
  /** Default selected when creating a new report */
  defaultVisible?: boolean;
  /** The heading in a CSV or Excel download, when it differs from the screen's. */
  exportLabel?: string;
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
  columns: { id: string; label: string; type: string; exportLabel?: string }[];
  rows: Record<string, unknown>[];
  totalRows: number;
  /** The days the rows cover, for reports that work them out themselves. */
  period?: { start: string; end: string; label: string };
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
};

/**
 * "This month" and "last week" are worked out when a report runs, so a saved
 * report keeps meaning the month just gone. Every report reads plain dates, so
 * the period is turned into them here, in one place, before the report sees it.
 */
function withCalendarDates(def: DataSourceDefinition): DataSourceDefinition {
  return {
    ...def,
    execute: (config, tenantId, ctx) => {
      const range = config.dateRange;
      if (range.type !== "calendar") return def.execute(config, tenantId, ctx);
      const { start, end } = daysOf(range, ctx?.timezone, ctx?.now);
      return def.execute({ ...config, dateRange: { type: "custom", startDate: start, endDate: end } }, tenantId, ctx);
    },
  };
}

const dataSources = Object.fromEntries(
  Object.entries(sources).map(([id, def]) => [id, withCalendarDates(def)])
) as Record<DataSourceId, DataSourceDefinition>;

export function getDataSource(id: DataSourceId): DataSourceDefinition {
  const source = dataSources[id];
  if (!source) throw new Error(`Unknown data source: ${id}`);
  return source;
}

export function getAllDataSources(): DataSourceDefinition[] {
  return Object.values(dataSources);
}
