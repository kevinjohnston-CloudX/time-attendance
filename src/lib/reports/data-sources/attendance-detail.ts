import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readable } from "../readable";
import { timesheetPayPeriodWhere } from "../date-scope";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { tenantWeekStart } from "../moving-period";
import { rateInEffect } from "@/lib/pay-rates";

/** What an hour pays in each bucket, against the rate: as Labor cost prices it. */
const MULTIPLIER: Record<string, number> = { REG: 1, OT: 1.5, DT: 2 };

/**
 * A clock time where the person works. Formatted with the server's own zone,
 * as it was, every time is 4 hours out on a server kept on UTC.
 */
function clockAt(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(instant);
}

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "timesheet.employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "timesheet.employee.wmsId",           type: "string" },
  department:    { prismaPath: "timesheet.employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "timesheet.employee.departmentId",     type: "string" },
  site:          { prismaPath: "timesheet.employee.site.name",        type: "string" },
  siteId:        { prismaPath: "timesheet.employee.siteId",           type: "string" },
  segmentType:   { prismaPath: "segmentType",                         type: "string" },
  payBucket:     { prismaPath: "payBucket",                           type: "string" },
  payCodeLabel:  { prismaPath: "payCode.label",                       type: "string" },
  segmentDate:   { prismaPath: "segmentDate",                         type: "date" },
  status:        { prismaPath: "timesheet.status",                    type: "string" },
  // The Date column, sorted in the database with the rest: sorted in memory
  // after the database sorted by name, it undid the name order.
  date:          { prismaPath: "segmentDate",                         type: "date" },
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
    { id: "date",            label: "Date",           type: "date",    defaultVisible: true, across: true },
    { id: "weekday",         label: "Day of the week", type: "string", defaultVisible: false, groupOrder: "weekdayOrder", across: true },
    { id: "segmentType",     label: "Type",   type: "string",  defaultVisible: true, across: true },
    { id: "startTime",       label: "Start",     type: "string",  defaultVisible: true },
    { id: "endTime",         label: "End",       type: "string",  defaultVisible: true },
    { id: "durationMinutes", label: "Length", type: "number",  defaultVisible: true },
    { id: "payBucket",       label: "Hours type",     type: "string",  defaultVisible: true, across: true },
    { id: "payCode",           label: "Pay code number", type: "string",  defaultVisible: true },
    { id: "payCodeLabel",      label: "Pay code",        type: "string",  defaultVisible: false, across: true },
    // The pay code with its hours type, so overtime on the Regular code reads as overtime.
    { id: "payCodeHours",      label: "Pay code and hours type", type: "string", defaultVisible: false, across: true },
    { id: "expressCode",       label: "Express code",    type: "string",  defaultVisible: false },
    { id: "adpCode",           label: "ADP code",        type: "string",  defaultVisible: false },
    { id: "status",            label: "Timesheet status", type: "string", defaultVisible: false },
    { id: "reasonCode",        label: "Reason code",     type: "string",  defaultVisible: false },
    { id: "regularMinutes",    label: "Regular",       type: "number",  defaultVisible: false },
    { id: "overtimeMinutes",   label: "Overtime",        type: "number",  defaultVisible: false },
    { id: "doubletimeMinutes", label: "Double time",        type: "number",  defaultVisible: false },
    { id: "paidMinutes",       label: "Paid hours",         type: "number",  defaultVisible: false },
    // Pay, for NovaTime's Wage and Upload reports: the Rate 1 in effect that
    // day, the bucket's multiplier, and the two together over the paid hours.
    { id: "agency",            label: "Agency",             type: "string",  defaultVisible: false },
    { id: "payRate",           label: "Pay rate",           type: "number",  defaultVisible: false },
    { id: "multiplier",        label: "Pay multiplier",     type: "number",  defaultVisible: false },
    { id: "payAmount",         label: "Pay",                type: "number",  defaultVisible: false, total: true },
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
    { id: "payCodeLabel", label: "Pay code", type: "string", operators: ["eq", "neq"] },
    { id: "status", label: "Timesheet status", type: "string", operators: ["eq", "in"],
      options: [
        { value: "OPEN", label: "Open" },
        { value: "LOCKED", label: "Locked" },
      ] },
  ],
  groupableFields: ["employeeName", "department", "site", "segmentType"],
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
        ? [...buildOrderBy(config.sortBy, fieldMap), { segmentDate: "asc" as const }, { startTime: "asc" as const }]
        : [{ segmentDate: "asc" as const }, { startTime: "asc" as const }];

    const segments = await db.workSegment.findMany({
      where,
      include: {
        payCode: { select: { code: true, label: true, expressCode: true, adpCode: true } },
        timesheet: {
          include: {
            employee: {
              include: {
                user: true, department: true, site: true,
                agencyRef: { select: { code: true, description: true } },
                payRates: { select: { effectiveDate: true, rate1: true } },
              },
            },
            dayReasons: { include: { reasonCode: { select: { code: true, label: true } } } },
          },
        },
      },
      orderBy,
      take: config.limit,
    });

    const weekStart = await tenantWeekStart(tenantId);
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
        weekday: seg.segmentDate.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        // The company's first day of the week first, for spreading the days across columns.
        weekdayOrder: (seg.segmentDate.getUTCDay() - weekStart + 7) % 7,
        segmentType: readable("segmentType", seg.segmentType),
        // Worked lines, meals and breaks have real times. Time off, holidays and
        // meal premiums are amounts placed on the day, and their times were
        // made up (PTO read 5:00 AM to 1:00 PM), so they show none.
        startTime: timed(seg.segmentType) ? clockAt(seg.startTime, personTimeZone(seg.timesheet.employee)) : null,
        endTime: timed(seg.segmentType) ? clockAt(seg.endTime, personTimeZone(seg.timesheet.employee)) : null,
        durationMinutes: seg.durationMinutes,
        // Paid time, as the timecard totals it: an unpaid meal is not in it,
        // and a meal premium is an hour of pay, not an hour worked.
        paidMinutes: seg.isPaid && seg.segmentType !== "MEAL_PREMIUM" ? seg.durationMinutes : null,
        ...pay(seg, seg.timesheet.employee),
        payBucket: readable("payBucket", seg.payBucket),
        payCode: seg.payCode?.code ?? null,
        payCodeLabel: seg.payCode?.label ?? null,
        payCodeHours: seg.payCode
          ? `${seg.payCode.label}${seg.segmentType === "WORK" && seg.payBucket === "OT" ? " (overtime)" : seg.segmentType === "WORK" && seg.payBucket === "DT" ? " (double time)" : ""}`
          : null,
        expressCode: seg.payCode?.expressCode ?? null,
        adpCode: seg.payCode?.adpCode ?? null,
        status: readable("timesheetStatus", seg.timesheet.status),
        reasonCode: dayReason ? `${dayReason.reasonCode.code} (${dayReason.reasonCode.label})` : null,
        // Hours worked only: a meal premium is an hour of pay, and time off is not worked.
        regularMinutes: seg.segmentType === "WORK" && seg.payBucket === "REG" ? seg.durationMinutes : null,
        overtimeMinutes: seg.segmentType === "WORK" && seg.payBucket === "OT" ? seg.durationMinutes : null,
        doubletimeMinutes: seg.segmentType === "WORK" && seg.payBucket === "DT" ? seg.durationMinutes : null,
        isPaid: seg.isPaid,
      };
    });

    // In-memory sort for computed columns (date, startTime, endTime, etc.)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    const colById = Object.fromEntries(attendanceDetailSource.columns.map((c) => [c.id, c]));
    const visibleColumns = config.columns.map((id) => colById[id]).filter(Boolean);

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
    case "calendar":
      // Turned into plain dates before any report runs (see data-sources/index).
      throw new Error("A calendar period reached a report that reads dates.");
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

/** The pay columns of one line: agency, the rate that day, the multiplier, and the pay. */
function pay(
  seg: { isPaid: boolean; segmentType: string; payBucket: string; durationMinutes: number; segmentDate: Date },
  employee: { agencyRef: { code: number; description: string } | null; payRates: { effectiveDate: Date; rate1: unknown }[] }
) {
  const agency = employee.agencyRef ? `${employee.agencyRef.code} ${employee.agencyRef.description}`.trim() : null;
  // A meal premium is an hour of pay at the rate: paid, though not hours worked.
  const paid = seg.isPaid;
  const rateRow = rateInEffect(employee.payRates, seg.segmentDate.toISOString().slice(0, 10));
  const rate = rateRow?.rate1 != null ? Number(rateRow.rate1) : null;
  const multiplier = paid ? (MULTIPLIER[seg.payBucket] ?? 1) : null;
  const amount = paid && rate != null && multiplier != null ? Math.round((seg.durationMinutes / 60) * rate * multiplier * 100) / 100 : null;
  return { agency, payRate: rate, multiplier, payAmount: amount };
}

/** Lines with real clock times: work, meals and breaks. */
function timed(segmentType: string): boolean {
  return segmentType === "WORK" || segmentType === "MEAL" || segmentType === "BREAK";
}
