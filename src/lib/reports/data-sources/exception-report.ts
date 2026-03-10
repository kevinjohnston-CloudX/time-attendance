import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { format } from "date-fns";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "timesheet.employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "timesheet.employee.employeeCode",    type: "string" },
  department:    { prismaPath: "timesheet.employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "timesheet.employee.departmentId",     type: "string" },
  siteId:        { prismaPath: "timesheet.employee.siteId",           type: "string" },
  exceptionType: { prismaPath: "exceptionType",                       type: "string" },
  occurredAt:    { prismaPath: "occurredAt",                          type: "date" },
  isResolved:    { prismaPath: "resolvedAt",                          type: "date" }, // not null = resolved
};

export const exceptionReportSource: DataSourceDefinition = {
  id: "EXCEPTION_REPORT",
  label: "Exception Report",
  description: "Attendance exceptions by type, date, and resolution status.",
  icon: "AlertCircle",
  columns: [
    { id: "employeeName",  label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",  label: "Emp Code",       type: "string",  defaultVisible: false },
    { id: "department",    label: "Department",      type: "string",  defaultVisible: true },
    { id: "exceptionType", label: "Exception Type",  type: "string",  defaultVisible: true },
    { id: "description",   label: "Description",     type: "string",  defaultVisible: true },
    { id: "occurredAt",    label: "Occurred At",     type: "date",    defaultVisible: true },
    { id: "resolved",      label: "Resolved",        type: "boolean", defaultVisible: true },
    { id: "resolvedAt",    label: "Resolved At",     type: "date",    defaultVisible: false },
    { id: "resolution",    label: "Resolution",      type: "string",  defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee Name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "exceptionType", label: "Exception Type", type: "string", operators: ["eq", "in"],
      options: [
        { value: "MISSING_PUNCH", label: "Missing Punch" },
        { value: "LONG_SHIFT", label: "Long Shift" },
        { value: "SHORT_BREAK", label: "Short Break" },
        { value: "MISSED_MEAL", label: "Missed Meal" },
        { value: "UNSCHEDULED_OT", label: "Unscheduled OT" },
        { value: "CONSECUTIVE_DAYS", label: "Consecutive Days" },
      ] },
  ],
  groupableFields: ["department", "exceptionType"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = resolveDateFilter(config.dateRange);
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    const where = {
      ...dateFilter,
      ...filterWhere,
      timesheet: {
        employee: {
          tenantId,
          ...(filterWhere.timesheet as Record<string, unknown> ?? {}),
        },
      },
    };

    const orderBy =
      config.sortBy.length > 0
        ? buildOrderBy(config.sortBy, fieldMap)
        : [{ occurredAt: "desc" as const }];

    const exceptions = await db.exception.findMany({
      where,
      include: {
        timesheet: {
          include: {
            employee: { include: { user: true, department: true } },
          },
        },
      },
      orderBy,
      take: config.limit,
    });

    const rows = exceptions.map((e) => ({
      employeeName: e.timesheet.employee.user?.name ?? e.timesheet.employee.employeeCode,
      employeeCode: e.timesheet.employee.employeeCode,
      department: e.timesheet.employee.department.name,
      exceptionType: e.exceptionType,
      description: e.description,
      occurredAt: format(e.occurredAt, "yyyy-MM-dd h:mm a"),
      resolved: !!e.resolvedAt,
      resolvedAt: e.resolvedAt ? format(e.resolvedAt, "yyyy-MM-dd h:mm a") : null,
      resolution: e.resolution,
    }));

    const visibleColumns = exceptionReportSource.columns.filter((c) =>
      config.columns.includes(c.id)
    );

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows,
      totalRows: rows.length,
    };
  },
};

function resolveDateFilter(dateRange: ReportConfig["dateRange"]): Record<string, unknown> {
  switch (dateRange.type) {
    case "payPeriod":
      return { timesheet: { payPeriodId: dateRange.payPeriodId } };
    case "custom":
      return {
        occurredAt: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return { occurredAt: { gte: start, lte: now } };
    }
  }
}
