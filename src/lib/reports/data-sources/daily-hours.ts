import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { format } from "date-fns";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "timesheet.employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "timesheet.employee.wmsId",           type: "string" },
  department:    { prismaPath: "timesheet.employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "timesheet.employee.departmentId",     type: "string" },
  site:          { prismaPath: "timesheet.employee.site.name",        type: "string" },
  siteId:        { prismaPath: "timesheet.employee.siteId",           type: "string" },
  payType:       { prismaPath: "timesheet.employee.payType",          type: "string" },
  segmentDate:   { prismaPath: "segmentDate",                         type: "date" },
};

export const dailyHoursSource: DataSourceDefinition = {
  id: "DAILY_HOURS",
  label: "Daily Hours",
  description: "One row per employee per day showing REG, OT, and DT hours alongside first clock-in and last clock-out.",
  icon: "CalendarClock",
  columns: [
    { id: "employeeName",    label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",    label: "Badge ID",       type: "string",  defaultVisible: false },
    { id: "department",      label: "Department",     type: "string",  defaultVisible: true },
    { id: "site",            label: "Site",           type: "string",  defaultVisible: false },
    { id: "date",            label: "Date",           type: "date",    defaultVisible: true },
    { id: "clockIn",         label: "Clock In",       type: "string",  defaultVisible: true },
    { id: "clockOut",        label: "Clock Out",      type: "string",  defaultVisible: true },
    { id: "regMinutes",      label: "REG (min)",      type: "number",  defaultVisible: true },
    { id: "otMinutes",       label: "OT (min)",       type: "number",  defaultVisible: true },
    { id: "dtMinutes",       label: "DT (min)",       type: "number",  defaultVisible: true },
    { id: "leaveMinutes",    label: "Leave (min)",    type: "number",  defaultVisible: false },
    { id: "totalMinutes",    label: "Total (min)",    type: "number",  defaultVisible: true },
    { id: "payType",         label: "Pay Type",       type: "string",  defaultVisible: false },
    { id: "payCodes",        label: "Pay Codes",      type: "string",  defaultVisible: false },
    { id: "reasonCode",      label: "Reason Code",    type: "string",  defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee Name", type: "string", operators: ["contains", "eq"] },
    { id: "employeeCode", label: "Badge ID",       type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department",     type: "string", operators: ["eq", "in"] },
    { id: "siteId",       label: "Site",           type: "string", operators: ["eq", "in"] },
    { id: "payType",      label: "Pay Type",       type: "string", operators: ["eq"],
      options: [
        { value: "HOURLY", label: "Hourly" },
        { value: "SALARY", label: "Salary" },
      ] },
  ],
  groupableFields: ["department", "site"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = resolveDateFilter(config.dateRange);
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    const dateTimesheetFilter = (dateFilter.timesheet as Record<string, unknown>) ?? {};
    const employeeFilter =
      ((filterWhere.timesheet as Record<string, unknown>)?.employee as Record<string, unknown>) ?? {};
    const { timesheet: _ft, ...rootFilterWhere } = filterWhere as Record<string, unknown>;

    const where = {
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
      orderBy: [{ segmentDate: "asc" }, { startTime: "asc" }],
      take: config.limit ? config.limit * 25 : undefined, // over-fetch since we collapse to day rows
    });

    // Group segments by employee + date.
    // Pass 1: build day entries and count hours from non-zero segments only.
    // Pass 2: merge pay codes from all segments (including 0-duration absent-day markers).
    type DayKey = string; // "employeeId|YYYY-MM-DD"
    const dayMap = new Map<DayKey, {
      employeeName: string;
      employeeCode: string;
      department: string;
      site: string;
      date: string;
      clockIn: Date | null;
      clockOut: Date | null;
      regMinutes: number;
      otMinutes: number;
      dtMinutes: number;
      leaveMinutes: number;
      payType: string;
      payCodeSet: Set<string>;
      reasonCode: string | null;
    }>();

    // Pass 1: create entries and count hours (non-zero segments only)
    for (const seg of segments) {
      if (seg.durationMinutes === 0) continue;

      const dateStr = seg.segmentDate.toISOString().slice(0, 10);
      const key: DayKey = `${seg.timesheet.employeeId}|${dateStr}`;

      if (!dayMap.has(key)) {
        const dayReason = seg.timesheet.dayReasons.find(
          (dr) => dr.segmentDate.toISOString().slice(0, 10) === dateStr
        );
        dayMap.set(key, {
          employeeName: seg.timesheet.employee.user?.name ?? seg.timesheet.employee.employeeCode,
          employeeCode: seg.timesheet.employee.wmsId ?? seg.timesheet.employee.employeeCode,
          department: seg.timesheet.employee.department.name,
          site: seg.timesheet.employee.site.name,
          date: dateStr,
          clockIn: null,
          clockOut: null,
          regMinutes: 0,
          otMinutes: 0,
          dtMinutes: 0,
          leaveMinutes: 0,
          payType: seg.timesheet.employee.payType === "SALARY" ? "Salary" : "Hourly",
          payCodeSet: new Set(),
          reasonCode: dayReason
            ? `${dayReason.reasonCode.code} - ${dayReason.reasonCode.label}`
            : null,
        });
      }

      const day = dayMap.get(key)!;
      const isSalary = seg.timesheet.employee.payType === "SALARY";

      if (seg.segmentType === "WORK") {
        if (!isSalary) {
          if (day.clockIn === null || seg.startTime < day.clockIn) day.clockIn = seg.startTime;
          if (day.clockOut === null || seg.endTime > day.clockOut) day.clockOut = seg.endTime;
        }

        if (seg.payBucket === "REG")       day.regMinutes += seg.durationMinutes;
        else if (seg.payBucket === "OT")   day.otMinutes  += seg.durationMinutes;
        else if (seg.payBucket === "DT")   day.dtMinutes  += seg.durationMinutes;
      } else if (seg.segmentType === "LEAVE") {
        day.leaveMinutes += seg.durationMinutes;
      }
    }

    // Pass 2: apply pay codes from 0-duration absent-day markers.
    // These markers are written by the timecard CODE dropdown (setAbsentDayPayCode) and
    // are the authoritative source for what the timecard shows on absent/leave days.
    // When a marker exists for a day, it replaces whatever pay codes were collected from
    // the underlying LEAVE segments (which may be stale from a policy sync or recalculate).
    for (const seg of segments) {
      if (seg.durationMinutes !== 0 || !seg.payCode) continue;
      const key: DayKey = `${seg.timesheet.employeeId}|${seg.segmentDate.toISOString().slice(0, 10)}`;
      const day = dayMap.get(key);
      if (day) {
        day.payCodeSet.clear();
        day.payCodeSet.add(`${seg.payCode.label} (${seg.payCode.code})`);
      }
    }

    const rows = Array.from(dayMap.values()).map((day) => ({
      employeeName:  day.employeeName,
      employeeCode:  day.employeeCode,
      department:    day.department,
      site:          day.site,
      date:          day.date,
      clockIn:       day.clockIn ? format(day.clockIn, "h:mm a") : null,
      clockOut:      day.clockOut ? format(day.clockOut, "h:mm a") : null,
      regMinutes:    day.regMinutes,
      otMinutes:     day.otMinutes,
      dtMinutes:     day.dtMinutes,
      leaveMinutes:  day.leaveMinutes,
      totalMinutes:  day.regMinutes + day.otMinutes + day.dtMinutes + day.leaveMinutes,
      payType:       day.payType,
      payCodes:      day.payCodeSet.size > 0 ? Array.from(day.payCodeSet).join(", ") : null,
      reasonCode:    day.reasonCode,
    }));

    // Apply row limit after collapsing
    const limitedRows = config.limit ? rows.slice(0, config.limit) : rows;

    const colById = Object.fromEntries(dailyHoursSource.columns.map((c) => [c.id, c]));
    const visibleColumns = config.columns.map((id) => colById[id]).filter(Boolean);

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: limitedRows,
      totalRows: limitedRows.length,
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
