import { db } from "@/lib/db";
import { readable } from "../readable";
import { dayAfter, payPeriodSpan } from "../date-scope";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { format } from "date-fns";

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
  label: "Time off requests",
  description: "Time off requests with their type, dates, length and status.",
  icon: "CalendarDays",
  columns: [
    { id: "employeeName",    label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",    label: "Employee code",       type: "string",  defaultVisible: false },
    { id: "department",      label: "Department",      type: "string",  defaultVisible: true },
    { id: "leaveType",       label: "Time off type",      type: "string",  defaultVisible: true },
    { id: "status",          label: "Status",          type: "string",  defaultVisible: true },
    { id: "startDate",       label: "Start date",      type: "date",    defaultVisible: true },
    { id: "endDate",         label: "End date",        type: "date",    defaultVisible: true },
    { id: "durationMinutes", label: "Hours",  type: "number",  defaultVisible: true },
    { id: "note",            label: "Note",            type: "string",  defaultVisible: false },
    { id: "reviewNote",      label: "Reviewer note",     type: "string",  defaultVisible: false },
    { id: "submittedAt",     label: "Submitted",       type: "date",    defaultVisible: false },
    { id: "reviewedAt",      label: "Reviewed",        type: "date",    defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "leaveTypeId", label: "Time off type", type: "string", operators: ["eq", "in"] },
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
      status: readable("leaveStatus", r.status),
      startDate: format(r.startDate, "yyyy-MM-dd"),
      endDate: format(r.endDate, "yyyy-MM-dd"),
      durationMinutes: r.durationMinutes,
      note: r.note,
      reviewNote: r.reviewNote,
      submittedAt: r.submittedAt ? format(r.submittedAt, "yyyy-MM-dd h:mm a") : null,
      reviewedAt: r.reviewedAt ? format(r.reviewedAt, "yyyy-MM-dd h:mm a") : null,
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

async function resolveDateFilter(
  dateRange: ReportConfig["dateRange"],
  tenantId: string
): Promise<Record<string, unknown>> {
  switch (dateRange.type) {
    case "payPeriod": {
      // Leave is not filed under a pay period, so a pay period means its
      // dates: every request that touches them. It used to mean every
      // request on file.
      const span = await payPeriodSpan(dateRange, tenantId);
      if (!span) return { id: "__none__" };
      return { startDate: { lt: span.end }, endDate: { gte: span.start } };
    }
    case "custom":
      // Requests that touch the picked days, not only those wholly inside.
      return {
        startDate: { lt: dayAfter(dateRange.endDate) },
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
