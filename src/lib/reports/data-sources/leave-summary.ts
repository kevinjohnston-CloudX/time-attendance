import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, type FieldMap } from "../query-builder";
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
      startDate: format(r.startDate, "yyyy-MM-dd"),
      endDate: format(r.endDate, "yyyy-MM-dd"),
      durationMinutes: r.durationMinutes,
      note: r.note,
      reviewNote: r.reviewNote,
      submittedAt: r.submittedAt ? format(r.submittedAt, "yyyy-MM-dd HH:mm") : null,
      reviewedAt: r.reviewedAt ? format(r.reviewedAt, "yyyy-MM-dd HH:mm") : null,
    }));

    const visibleColumns = leaveSummarySource.columns.filter((c) =>
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
      return {}; // Leave requests aren't tied to pay periods; show all
    case "custom":
      return {
        startDate: { gte: new Date(dateRange.startDate) },
        endDate: { lte: new Date(dateRange.endDate) },
      };
    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return { startDate: { gte: start } };
    }
  }
}
