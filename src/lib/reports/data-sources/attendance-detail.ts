import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readable } from "../readable";
import { timesheetPayPeriodWhere } from "../date-scope";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { format } from "date-fns";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "timesheet.employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "timesheet.employee.wmsId",           type: "string" },
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
  label: "Daily attendance",
  description: "Each day's clock in and clock out times, meals and hours worked.",
  icon: "CalendarDays",
  columns: [
    { id: "employeeName",    label: "Employee",      type: "string",  defaultVisible: true },
    { id: "employeeCode",    label: "Badge ID",      type: "string",  defaultVisible: false },
    { id: "department",      label: "Department",     type: "string",  defaultVisible: true },
    { id: "site",            label: "Site",           type: "string",  defaultVisible: false },
    { id: "date",            label: "Date",           type: "date",    defaultVisible: true },
    { id: "segmentType",     label: "Type",   type: "string",  defaultVisible: true },
    { id: "startTime",       label: "Start",     type: "string",  defaultVisible: true },
    { id: "endTime",         label: "End",       type: "string",  defaultVisible: true },
    { id: "durationMinutes", label: "Hours", type: "number",  defaultVisible: true },
    { id: "payBucket",       label: "Hours type",     type: "string",  defaultVisible: true },
    { id: "payCode",           label: "Pay Code",        type: "string",  defaultVisible: true },
    { id: "payCodeLabel",      label: "Pay Code Label",  type: "string",  defaultVisible: false },
    { id: "reasonCode",        label: "Reason Code",     type: "string",  defaultVisible: false },
    { id: "regularMinutes",    label: "REG (min)",       type: "number",  defaultVisible: false },
    { id: "overtimeMinutes",   label: "OT (min)",        type: "number",  defaultVisible: false },
    { id: "doubletimeMinutes", label: "DT (min)",        type: "number",  defaultVisible: false },
    { id: "isPaid",          label: "Paid",           type: "boolean", defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "segmentType", label: "Type", type: "string", operators: ["eq", "in"],
      options: [
        { value: "WORK", label: "Work" },
        { value: "MEAL", label: "Meal" },
        { value: "BREAK", label: "Break" },
        { value: "LEAVE", label: "Leave" },
      ] },
    { id: "payBucket", label: "Hours type", type: "string", operators: ["eq", "in"],
      options: [
        { value: "REG",          label: "Regular" },
        { value: "OT",           label: "Overtime" },
        { value: "DT",           label: "Double Time" },
        { value: "MEAL_PENALTY", label: "Meal Penalty" },
        { value: "HOLIDAY",      label: "Holiday" },
        { value: "PTO",          label: "PTO" },
        { value: "SICK",         label: "Sick" },
        { value: "FMLA",         label: "FMLA" },
        { value: "BEREAVEMENT",  label: "Bereavement" },
        { value: "JURY_DUTY",    label: "Jury Duty" },
        { value: "MILITARY",     label: "Military" },
        { value: "UNPAID",       label: "Unpaid" },
      ] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
  ],
  groupableFields: ["department", "site", "segmentType"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = await resolveDateFilter(config.dateRange, tenantId);
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    // dateFilter puts payPeriodId inside timesheet; custom/relative put segmentDate at root.
    const dateTimesheetFilter = (dateFilter.timesheet as Record<string, unknown>) ?? {};
    // filterWhere nests all employee-level conditions under timesheet.employee.*
    const employeeFilter =
      ((filterWhere.timesheet as Record<string, unknown>)?.employee as Record<string, unknown>) ?? {};

    // Spread root-level scalar filters (segmentType, payBucket, segmentDate from filterWhere)
    // but exclude the timesheet key — we merge that manually below.
    const { timesheet: _ft, ...rootFilterWhere } = filterWhere as Record<string, unknown>;

    const where = {
      durationMinutes: { gt: 0 },
      ...(dateFilter.segmentDate !== undefined ? { segmentDate: dateFilter.segmentDate } : {}),
      ...rootFilterWhere,
      timesheet: {
        ...dateTimesheetFilter,
        employee: {
          tenantId,
          ...employeeFilter,
        },
      },
    } as Prisma.WorkSegmentWhereInput;

    const orderBy =
      config.sortBy.length > 0
        ? buildOrderBy(config.sortBy, fieldMap)
        : [{ segmentDate: "asc" as const }, { startTime: "asc" as const }];

    const segments = await db.workSegment.findMany({
      where,
      include: {
        payCode: { select: { code: true, label: true } },
        timesheet: {
          include: {
            employee: { include: { user: true, department: true, site: true } },
            dayReasons: { include: { reasonCode: { select: { code: true, label: true } } } },
          },
        },
      },
      orderBy,
      take: config.limit,
    });

    const rows = segments.map((seg) => {
      const dayStr = seg.segmentDate.toISOString().slice(0, 10);
      const dayReason = seg.timesheet.dayReasons.find(
        (dr) => dr.segmentDate.toISOString().slice(0, 10) === dayStr
      );
      return {
        employeeName: seg.timesheet.employee.user?.name ?? seg.timesheet.employee.employeeCode,
        employeeCode: seg.timesheet.employee.wmsId ?? seg.timesheet.employee.employeeCode,
        department: seg.timesheet.employee.department.name,
        site: seg.timesheet.employee.site.name,
        date: seg.segmentDate.toISOString().slice(0, 10),
        segmentType: readable("segmentType", seg.segmentType),
        startTime: format(seg.startTime, "h:mm a"),
        endTime: format(seg.endTime, "h:mm a"),
        durationMinutes: seg.durationMinutes,
        payBucket: readable("payBucket", seg.payBucket),
        payCode: seg.payCode?.code ?? null,
        payCodeLabel: seg.payCode?.label ?? null,
        reasonCode: dayReason ? `${dayReason.reasonCode.code} (${dayReason.reasonCode.label})` : null,
        regularMinutes: seg.payBucket === "REG" ? seg.durationMinutes : null,
        overtimeMinutes: seg.payBucket === "OT" ? seg.durationMinutes : null,
        doubletimeMinutes: seg.payBucket === "DT" ? seg.durationMinutes : null,
        isPaid: seg.isPaid,
      };
    });

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

async function resolveDateFilter(
  dateRange: ReportConfig["dateRange"],
  tenantId: string
): Promise<Record<string, unknown>> {
  switch (dateRange.type) {
    case "payPeriod":
      return { timesheet: await timesheetPayPeriodWhere(dateRange, tenantId) };
    case "custom":
      return {
        segmentDate: {
          gte: new Date(`${dateRange.startDate}T00:00:00.000Z`),
          lte: new Date(`${dateRange.endDate}T23:59:59.999Z`),
        },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - dateRange.relativeDays);
      start.setUTCHours(0, 0, 0, 0);
      return { segmentDate: { gte: start, lte: now } };
    }
    case "today": {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date();
      end.setUTCHours(23, 59, 59, 999);
      return { segmentDate: { gte: start, lte: end } };
    }
    case "yesterday": {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 1);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date();
      end.setUTCDate(end.getUTCDate() - 1);
      end.setUTCHours(23, 59, 59, 999);
      return { segmentDate: { gte: start, lte: end } };
    }
  }
}
