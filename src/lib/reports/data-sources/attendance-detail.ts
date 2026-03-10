import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { format } from "date-fns";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "timesheet.employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "timesheet.employee.employeeCode",    type: "string" },
  department:    { prismaPath: "timesheet.employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "timesheet.employee.departmentId",     type: "string" },
  site:          { prismaPath: "timesheet.employee.site.name",        type: "string" },
  siteId:        { prismaPath: "timesheet.employee.siteId",           type: "string" },
  segmentType:   { prismaPath: "segmentType",                         type: "string" },
  payBucket:     { prismaPath: "payBucket",                           type: "string" },
  segmentDate:   { prismaPath: "segmentDate",                         type: "date" },
};

export const attendanceDetailSource: DataSourceDefinition = {
  id: "ATTENDANCE_DETAIL",
  label: "Attendance Detail",
  description: "Daily attendance records with clock in/out times, segment breakdown, and hours worked.",
  icon: "CalendarDays",
  columns: [
    { id: "employeeName",    label: "Employee",      type: "string",  defaultVisible: true },
    { id: "employeeCode",    label: "Emp Code",      type: "string",  defaultVisible: false },
    { id: "department",      label: "Department",     type: "string",  defaultVisible: true },
    { id: "site",            label: "Site",           type: "string",  defaultVisible: false },
    { id: "date",            label: "Date",           type: "date",    defaultVisible: true },
    { id: "segmentType",     label: "Segment Type",   type: "string",  defaultVisible: true },
    { id: "startTime",       label: "Start Time",     type: "string",  defaultVisible: true },
    { id: "endTime",         label: "End Time",       type: "string",  defaultVisible: true },
    { id: "durationMinutes", label: "Duration (min)", type: "number",  defaultVisible: true },
    { id: "payBucket",       label: "Pay Bucket",     type: "string",  defaultVisible: true },
    { id: "isPaid",          label: "Paid",           type: "boolean", defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee Name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "segmentType", label: "Segment Type", type: "string", operators: ["eq", "in"],
      options: [
        { value: "WORK", label: "Work" },
        { value: "MEAL", label: "Meal" },
        { value: "BREAK", label: "Break" },
        { value: "LEAVE", label: "Leave" },
      ] },
    { id: "payBucket", label: "Pay Bucket", type: "string", operators: ["eq", "in"] },
  ],
  groupableFields: ["department", "site", "segmentType"],
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
        : [{ segmentDate: "asc" as const }, { startTime: "asc" as const }];

    const segments = await db.workSegment.findMany({
      where,
      include: {
        timesheet: {
          include: {
            employee: { include: { user: true, department: true, site: true } },
          },
        },
      },
      orderBy,
      take: config.limit,
    });

    const rows = segments.map((seg) => ({
      employeeName: seg.timesheet.employee.user?.name ?? seg.timesheet.employee.employeeCode,
      employeeCode: seg.timesheet.employee.employeeCode,
      department: seg.timesheet.employee.department.name,
      site: seg.timesheet.employee.site.name,
      date: format(seg.segmentDate, "yyyy-MM-dd"),
      segmentType: seg.segmentType,
      startTime: format(seg.startTime, "h:mm a"),
      endTime: format(seg.endTime, "h:mm a"),
      durationMinutes: seg.durationMinutes,
      payBucket: seg.payBucket,
      isPaid: seg.isPaid,
    }));

    // In-memory sort for computed columns (date, startTime, endTime, etc.)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    const visibleColumns = attendanceDetailSource.columns.filter((c) =>
      config.columns.includes(c.id)
    );

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: sortedRows,
      totalRows: sortedRows.length,
    };
  },
};

function resolveDateFilter(dateRange: ReportConfig["dateRange"]): Record<string, unknown> {
  switch (dateRange.type) {
    case "payPeriod":
      return { timesheet: { payPeriodId: dateRange.payPeriodId } };
    case "custom":
      return {
        segmentDate: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return { segmentDate: { gte: start, lte: now } };
    }
  }
}
