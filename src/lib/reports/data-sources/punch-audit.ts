import { db } from "@/lib/db";
import { readable } from "../readable";
import { dayAfter, timesheetPayPeriodWhere } from "../date-scope";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { localDay } from "../scope";

/** A time of day on a zone's clock, with seconds: "7:58:12 AM". */
function localTime(at: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(at);
}

const fieldMap: FieldMap = {
  employeeName: { prismaPath: "employee.user.name",       type: "string" },
  employeeCode: { prismaPath: "employee.wmsId",           type: "string" },
  department:   { prismaPath: "employee.department.name",  type: "string" },
  departmentId: { prismaPath: "employee.departmentId",     type: "string" },
  siteId:       { prismaPath: "employee.siteId",           type: "string" },
  punchType:    { prismaPath: "punchType",                 type: "string" },
  source:       { prismaPath: "source",                    type: "string" },
  isApproved:   { prismaPath: "isApproved",                type: "boolean" },
  punchTime:    { prismaPath: "punchTime",                 type: "date" },
};

export const punchAuditSource: DataSourceDefinition = {
  id: "PUNCH_AUDIT",
  label: "Punch audit",
  description: "Every punch, where it came from, and any corrections or approvals.",
  icon: "FileSearch",
  columns: [
    { id: "employeeName",  label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",  label: "Badge ID",       type: "string",  defaultVisible: false },
    { id: "department",    label: "Department",      type: "string",  defaultVisible: true },
    { id: "punchType",     label: "Punch",      type: "string",  defaultVisible: true },
    { id: "punchTime",     label: "Time",      type: "string",  defaultVisible: true },
    { id: "roundedTime",   label: "Rounded time",    type: "string",  defaultVisible: true },
    { id: "source",        label: "Source",           type: "string",  defaultVisible: true },
    { id: "stateBefore",   label: "Status before",     type: "string",  defaultVisible: false },
    { id: "stateAfter",    label: "Status after",      type: "string",  defaultVisible: true },
    { id: "isApproved",    label: "Approved",         type: "boolean", defaultVisible: true },
    { id: "isCorrection",  label: "Correction",    type: "boolean", defaultVisible: true },
    { id: "note",          label: "Note",             type: "string",  defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "punchType", label: "Punch", type: "string", operators: ["eq", "in"],
      options: [
        { value: "CLOCK_IN", label: "Clock in" },
        { value: "CLOCK_OUT", label: "Clock out" },
        { value: "MEAL_START", label: "Meal start" },
        { value: "MEAL_END", label: "Meal end" },
        { value: "BREAK_START", label: "Break start" },
        { value: "BREAK_END", label: "Break end" },
      ] },
    { id: "source", label: "Source", type: "string", operators: ["eq", "in"],
      options: [
        { value: "WEB", label: "Web" },
        { value: "KIOSK", label: "Kiosk" },
        { value: "MOBILE", label: "Mobile" },
        { value: "MANUAL", label: "Manual" },
        { value: "SYSTEM", label: "System" },
      ] },
    { id: "isApproved", label: "Approved", type: "boolean", operators: ["eq"] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
  ],
  groupableFields: ["employeeName", "department", "punchType", "source"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = await resolveDateFilter(config.dateRange, tenantId);
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    const where = {
      ...dateFilter,
      ...filterWhere,
      employee: {
        tenantId,
        ...(filterWhere.employee as Record<string, unknown> ?? {}),
      },
    };

    const orderBy =
      config.sortBy.length > 0
        ? buildOrderBy(config.sortBy, fieldMap)
        : [{ punchTime: "desc" as const }];

    const found = await db.punch.findMany({
      where,
      include: {
        employee: { include: { user: true, department: true, site: { select: { timezone: true } } } },
      },
      orderBy,
      take: config.limit,
    });
    // A range of days is each employee's own days: the query reads a little
    // either side of it (see resolveDateFilter) and this keeps the punches
    // that fall on those days where the person works.
    const days = config.dateRange.type === "custom" ? config.dateRange : null;
    const punches = days
      ? found.filter((p) => {
          const d = localDay(p.punchTime, personTimeZone(p.employee));
          return d >= days.startDate.slice(0, 10) && d <= days.endDate.slice(0, 10);
        })
      : found;

    // Times on the employee's own clock. The server runs on UTC in
    // production, so they read four to five hours late.
    const stamp = (at: Date, zone: string) => `${localDay(at, zone)} ${localTime(at, zone)}`;
    const rows = punches.map((p) => ({
      employeeName: p.employee.user?.name ?? p.employee.employeeCode,
      employeeCode: p.employee.wmsId ?? p.employee.employeeCode,
      department: p.employee.department.name,
      punchType: readable("punchType", p.punchType),
      punchTime: stamp(p.punchTime, personTimeZone(p.employee)),
      roundedTime: stamp(p.roundedTime, personTimeZone(p.employee)),
      source: readable("punchSource", p.source),
      stateBefore: readable("punchState", p.stateBefore),
      stateAfter: readable("punchState", p.stateAfter),
      isApproved: p.isApproved,
      isCorrection: !!p.correctsId,
      note: p.note,
    }));

    // In-memory sort for computed columns (roundedTime, stateBefore, stateAfter, etc.)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    const colById = Object.fromEntries(punchAuditSource.columns.map((c) => [c.id, c]));
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
        // Whole days, wide enough for every zone a person can work in
        // (14 hours either side of UTC); execute() then keeps the punches on
        // those days on each person's own clock. UTC midnights alone cut a
        // US day at 7 or 8 PM.
        punchTime: {
          gte: new Date(new Date(dateRange.startDate).getTime() - 14 * 3_600_000),
          lt: new Date(dayAfter(dateRange.endDate).getTime() + 14 * 3_600_000),
        },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return { punchTime: { gte: start, lte: now } };
    }
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return { punchTime: { gte: start, lte: end } };
    }
    case "yesterday": {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { punchTime: { gte: start, lte: end } };
    }
  }
}
