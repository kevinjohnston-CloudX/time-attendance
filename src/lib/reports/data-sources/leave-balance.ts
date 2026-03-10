import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";

const fieldMap: FieldMap = {
  employeeName: { prismaPath: "employee.user.name",       type: "string" },
  employeeCode: { prismaPath: "employee.employeeCode",    type: "string" },
  department:   { prismaPath: "employee.department.name",  type: "string" },
  departmentId: { prismaPath: "employee.departmentId",     type: "string" },
  siteId:       { prismaPath: "employee.siteId",           type: "string" },
  leaveType:    { prismaPath: "leaveType.name",            type: "string" },
  leaveTypeId:  { prismaPath: "leaveTypeId",               type: "string" },
  accrualYear:  { prismaPath: "accrualYear",               type: "number" },
};

export const leaveBalanceSource: DataSourceDefinition = {
  id: "LEAVE_BALANCE",
  label: "Leave Balances",
  description: "Current leave balances by employee and leave type.",
  icon: "Wallet",
  columns: [
    { id: "employeeName",   label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",   label: "Emp Code",       type: "string",  defaultVisible: false },
    { id: "department",     label: "Department",      type: "string",  defaultVisible: true },
    { id: "leaveType",      label: "Leave Type",      type: "string",  defaultVisible: true },
    { id: "accrualYear",    label: "Year",            type: "number",  defaultVisible: true },
    { id: "balanceMinutes", label: "Balance (min)",   type: "number",  defaultVisible: true },
    { id: "usedMinutes",    label: "Used (min)",      type: "number",  defaultVisible: true },
    { id: "remainingMinutes", label: "Remaining (min)", type: "number", defaultVisible: true },
  ],
  filters: [
    { id: "employeeName", label: "Employee Name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "leaveTypeId", label: "Leave Type", type: "string", operators: ["eq", "in"] },
    { id: "accrualYear", label: "Year", type: "number", operators: ["eq"] },
  ],
  groupableFields: ["department", "leaveType"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    // Default to current year if no year filter provided
    const hasYearFilter = config.filters.some((f) => f.field === "accrualYear");
    const yearFilter = hasYearFilter ? {} : { accrualYear: new Date().getFullYear() };

    const where = {
      ...yearFilter,
      ...filterWhere,
      employee: {
        tenantId,
        ...(filterWhere.employee as Record<string, unknown> ?? {}),
      },
    };

    const balances = await db.leaveBalance.findMany({
      where,
      include: {
        employee: { include: { user: true, department: true } },
        leaveType: true,
      },
      orderBy: [
        { employee: { user: { name: "asc" } } },
        { leaveType: { name: "asc" } },
      ],
      take: config.limit,
    });

    const rows = balances.map((b) => ({
      employeeName: b.employee.user?.name ?? b.employee.employeeCode,
      employeeCode: b.employee.employeeCode,
      department: b.employee.department.name,
      leaveType: b.leaveType.name,
      accrualYear: b.accrualYear,
      balanceMinutes: b.balanceMinutes,
      usedMinutes: b.usedMinutes,
      remainingMinutes: b.balanceMinutes - b.usedMinutes,
    }));

    // In-memory sort for computed columns (balanceMinutes, usedMinutes, remainingMinutes)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    const visibleColumns = leaveBalanceSource.columns.filter((c) =>
      config.columns.includes(c.id)
    );

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: sortedRows,
      totalRows: sortedRows.length,
    };
  },
};
