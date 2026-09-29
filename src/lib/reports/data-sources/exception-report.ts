import { db } from "@/lib/db";
import { readable } from "../readable";
import { dayAfter, timesheetPayPeriodWhere } from "../date-scope";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
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
  label: "Exceptions",
  description: "Missed punches, absences and other rule breaks, and whether they were fixed.",
  icon: "AlertCircle",
  columns: [
    { id: "employeeName",  label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",  label: "Employee code",       type: "string",  defaultVisible: false },
    { id: "department",    label: "Department",      type: "string",  defaultVisible: true },
    { id: "exceptionType", label: "Exception",  type: "string",  defaultVisible: true },
    { id: "description",   label: "Description",     type: "string",  defaultVisible: true },
    { id: "occurredAt",    label: "When",     type: "date",    defaultVisible: true },
    { id: "resolved",      label: "Fixed",        type: "boolean", defaultVisible: true },
    { id: "resolvedAt",    label: "Fixed on",     type: "date",    defaultVisible: false },
    { id: "resolution",    label: "Resolution",      type: "string",  defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "exceptionType", label: "Exception", type: "string", operators: ["eq", "in"],
      options: [
        { value: "MISSING_PUNCH", label: "Missing punch" },
        { value: "LONG_SHIFT", label: "Long shift" },
        { value: "SHORT_BREAK", label: "Short break" },
        { value: "MISSED_MEAL", label: "Missed meal" },
        { value: "UNSCHEDULED_OT", label: "Unscheduled overtime" },
        { value: "CONSECUTIVE_DAYS", label: "Consecutive days" },
        { value: "ABSENT", label: "Absent" },
      ] },
  ],
  groupableFields: ["department", "exceptionType"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = await resolveDateFilter(config.dateRange, tenantId);
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    // The pay period lives on the timesheet too, so the two are merged: this
    // key used to replace the date filter's, and a report run for one pay
    // period returned every pay period on file.
    const where = {
      ...dateFilter,
      ...filterWhere,
      timesheet: {
        ...((dateFilter.timesheet as Record<string, unknown>) ?? {}),
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
      exceptionType: readable("exceptionType", e.exceptionType),
      description: e.description,
      occurredAt: format(e.occurredAt, "yyyy-MM-dd h:mm a"),
      resolved: !!e.resolvedAt,
      resolvedAt: e.resolvedAt ? format(e.resolvedAt, "yyyy-MM-dd h:mm a") : null,
      resolution: e.resolution,
    }));

    // In-memory sort for computed columns (description, resolved, resolvedAt, resolution)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    const visibleColumns = exceptionReportSource.columns.filter((c) =>
      config.columns.includes(c.id)
    );

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: sortedRows,
      totalRows: sortedRows.length,
    };
  },
};

async function resolveDateFilter(
  dateRange: ReportConfig["dateRange"],
  tenantId: string
): Promise<Record<string, unknown>> {
  switch (dateRange.type) {
    case "payPeriod":
      return { timesheet: await timesheetPayPeriodWhere(dateRange, tenantId) };
    case "custom":
      return {
        // Whole days: up to the end of the last picked day, which "lte
        // midnight" used to leave out.
        occurredAt: {
          gte: new Date(dateRange.startDate),
          lt: dayAfter(dateRange.endDate),
        },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return { occurredAt: { gte: start, lte: now } };
    }
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return { occurredAt: { gte: start, lte: end } };
    }
    case "yesterday": {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { occurredAt: { gte: start, lte: end } };
    }
  }
}
