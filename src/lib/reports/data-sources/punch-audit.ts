import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { format } from "date-fns";

const fieldMap: FieldMap = {
  employeeName: { prismaPath: "employee.user.name",       type: "string" },
  employeeCode: { prismaPath: "employee.employeeCode",    type: "string" },
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
  label: "Punch Audit",
  description: "Raw punch log with times, corrections, sources, and approval status.",
  icon: "FileSearch",
  columns: [
    { id: "employeeName",  label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",  label: "Emp Code",       type: "string",  defaultVisible: false },
    { id: "department",    label: "Department",      type: "string",  defaultVisible: true },
    { id: "punchType",     label: "Punch Type",      type: "string",  defaultVisible: true },
    { id: "punchTime",     label: "Punch Time",      type: "string",  defaultVisible: true },
    { id: "roundedTime",   label: "Rounded Time",    type: "string",  defaultVisible: true },
    { id: "source",        label: "Source",           type: "string",  defaultVisible: true },
    { id: "stateBefore",   label: "State Before",     type: "string",  defaultVisible: false },
    { id: "stateAfter",    label: "State After",      type: "string",  defaultVisible: true },
    { id: "isApproved",    label: "Approved",         type: "boolean", defaultVisible: true },
    { id: "isCorrection",  label: "Is Correction",    type: "boolean", defaultVisible: true },
    { id: "note",          label: "Note",             type: "string",  defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee Name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "punchType", label: "Punch Type", type: "string", operators: ["eq", "in"],
      options: [
        { value: "CLOCK_IN", label: "Clock In" },
        { value: "CLOCK_OUT", label: "Clock Out" },
        { value: "MEAL_START", label: "Meal Start" },
        { value: "MEAL_END", label: "Meal End" },
        { value: "BREAK_START", label: "Break Start" },
        { value: "BREAK_END", label: "Break End" },
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
  ],
  groupableFields: ["department", "punchType", "source"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = resolveDateFilter(config.dateRange);
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

    const punches = await db.punch.findMany({
      where,
      include: {
        employee: { include: { user: true, department: true } },
      },
      orderBy,
      take: config.limit,
    });

    const rows = punches.map((p) => ({
      employeeName: p.employee.user?.name ?? p.employee.employeeCode,
      employeeCode: p.employee.employeeCode,
      department: p.employee.department.name,
      punchType: p.punchType,
      punchTime: format(p.punchTime, "yyyy-MM-dd h:mm:ss a"),
      roundedTime: format(p.roundedTime, "yyyy-MM-dd h:mm:ss a"),
      source: p.source,
      stateBefore: p.stateBefore,
      stateAfter: p.stateAfter,
      isApproved: p.isApproved,
      isCorrection: !!p.correctsId,
      note: p.note,
    }));

    // In-memory sort for computed columns (roundedTime, stateBefore, stateAfter, etc.)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    const visibleColumns = punchAuditSource.columns.filter((c) =>
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
        punchTime: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return { punchTime: { gte: start, lte: now } };
    }
  }
}
