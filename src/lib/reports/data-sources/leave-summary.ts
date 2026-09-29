import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { format as fnsFormat } from "date-fns";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "employee.employeeCode",    type: "string" },
  department:    { prismaPath: "employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "employee.departmentId",     type: "string" },
  siteId:        { prismaPath: "employee.siteId",           type: "string" },
  leaveType:     { prismaPath: "leaveType.name",            type: "string" },
  leaveTypeId:   { prismaPath: "leaveTypeId",               type: "string" },
  status:        { prismaPath: "status",                    type: "string" },
  startDate:     { prismaPath: "startDate",                 type: "date" },
};

export const leaveSummarySource: DataSourceDefinition = {
  id: "LEAVE_SUMMARY",
  label: "Leave Summary",
  description: "Leave requests with status, type, duration, and date range.",
  icon: "CalendarDays",
  columns: [
    { id: "employeeName",    label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",    label: "Emp Code",       type: "string",  defaultVisible: false },
    { id: "department",      label: "Department",      type: "string",  defaultVisible: true },
    { id: "leaveType",       label: "Leave Type",      type: "string",  defaultVisible: true },
    { id: "status",          label: "Status",          type: "string",  defaultVisible: true },
    { id: "startDate",       label: "Start Date",      type: "date",    defaultVisible: true },
    { id: "endDate",         label: "End Date",        type: "date",    defaultVisible: true },
    { id: "durationMinutes", label: "Duration (min)",  type: "number",  defaultVisible: true },
    { id: "note",            label: "Note",            type: "string",  defaultVisible: false },
    { id: "reviewNote",      label: "Review Note",     type: "string",  defaultVisible: false },
    { id: "submittedAt",     label: "Submitted",       type: "date",    defaultVisible: false },
    { id: "reviewedAt",      label: "Reviewed",        type: "date",    defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee Name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "leaveTypeId", label: "Leave Type", type: "string", operators: ["eq", "in"] },
    { id: "status", label: "Status", type: "string", operators: ["eq", "in"],
      options: [
        { value: "DRAFT", label: "Draft" },
        { value: "PENDING", label: "Pending" },
        { value: "APPROVED", label: "Approved" },
        { value: "REJECTED", label: "Rejected" },
        { value: "CANCELLED", label: "Cancelled" },
        { value: "POSTED", label: "Posted" },
      ] },
  ],
  groupableFields: ["department", "leaveType", "status"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const dateFilter = await resolveDateFilter(config.dateRange);
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
        : [{ startDate: "desc" as const }];

    const requests = await db.leaveRequest.findMany({
      where,
      include: {
        employee: { include: { user: true, department: true } },
        leaveType: true,
      },
      orderBy,
      take: config.limit,
    });

    const rows = requests.map((r) => ({
      employeeName: r.employee.user?.name ?? r.employee.employeeCode,
      employeeCode: r.employee.employeeCode,
      department: r.employee.department.name,
      leaveType: r.leaveType.name,
      status: r.status,
      startDate: fnsFormat(r.startDate, "yyyy-MM-dd"),
      endDate: fnsFormat(r.endDate, "yyyy-MM-dd"),
      durationMinutes: r.durationMinutes,
      note: r.note,
      reviewNote: r.reviewNote,
      submittedAt: r.submittedAt ? fnsFormat(r.submittedAt, "yyyy-MM-dd HH:mm") : null,
      reviewedAt: r.reviewedAt ? fnsFormat(r.reviewedAt, "yyyy-MM-dd HH:mm") : null,
    }));

    // In-memory sort for computed columns (endDate, durationMinutes, etc.)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    const visibleColumns = leaveSummarySource.columns.filter((c) =>
      config.columns.includes(c.id)
    );

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: sortedRows,
      totalRows: sortedRows.length,
    };
  },
};

async function resolveDateFilter(dateRange: ReportConfig["dateRange"]): Promise<Record<string, unknown>> {
  switch (dateRange.type) {
    case "payPeriod": {
      const period = await db.payPeriod.findUnique({
        where: { id: dateRange.payPeriodId },
        select: { startDate: true, endDate: true },
      });
      if (!period) return {};
      // Return leave requests that overlap the pay period window
      return {
        startDate: { lte: period.endDate },
        endDate: { gte: period.startDate },
      };
    }
    case "custom":
      return {
        startDate: { lte: new Date(dateRange.endDate) },
        endDate: { gte: new Date(dateRange.startDate) },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return {
        startDate: { lte: now },
        endDate: { gte: start },
      };
    }
    case "today": {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      return { startDate: { lte: end }, endDate: { gte: start } };
    }
    case "yesterday": {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { startDate: { lte: end }, endDate: { gte: start } };
    }
  }
}
