import type { ReportConfig, DataSourceId } from "@/lib/validators/report.schema";
import type { FieldMap } from "../query-builder";
import { hoursSummarySource } from "./hours-summary";
import { attendanceDetailSource } from "./attendance-detail";
import { leaveSummarySource } from "./leave-summary";
import { leaveBalanceSource } from "./leave-balance";
import { punchAuditSource } from "./punch-audit";
import { exceptionReportSource } from "./exception-report";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ColumnDef {
  id: string;
  label: string;
  type: "string" | "number" | "date" | "boolean";
  /** Default selected when creating a new report */
  defaultVisible?: boolean;
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
  columns: { id: string; label: string; type: string }[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

export interface DataSourceDefinition {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string; // Lucide icon name
  columns: ColumnDef[];
  filters: FilterFieldDef[];
  groupableFields: string[];
  fieldMap: FieldMap;
  execute: (
    config: ReportConfig,
    tenantId: string
  ) => Promise<ReportResult>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const dataSources: Record<DataSourceId, DataSourceDefinition> = {
  HOURS_SUMMARY: hoursSummarySource,
  ATTENDANCE_DETAIL: attendanceDetailSource,
  LEAVE_SUMMARY: leaveSummarySource,
  LEAVE_BALANCE: leaveBalanceSource,
  PUNCH_AUDIT: punchAuditSource,
  EXCEPTION_REPORT: exceptionReportSource,
};

export function getDataSource(id: DataSourceId): DataSourceDefinition {
  const source = dataSources[id];
  if (!source) throw new Error(`Unknown data source: ${id}`);
  return source;
}

export function getAllDataSources(): DataSourceDefinition[] {
  return Object.values(dataSources);
}
