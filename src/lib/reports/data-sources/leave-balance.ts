import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";

const fieldMap: FieldMap = {
  employeeName: { prismaPath: "employee.user.name",       type: "string" },
  employeeCode: { prismaPath: "employee.wmsId",           type: "string" },
  department:   { prismaPath: "employee.department.name",  type: "string" },
  departmentId: { prismaPath: "employee.departmentId",     type: "string" },
  siteId:       { prismaPath: "employee.siteId",           type: "string" },
  leaveType:    { prismaPath: "leaveType.name",            type: "string" },
  leaveTypeId:  { prismaPath: "leaveTypeId",               type: "string" },
  accrualYear:  { prismaPath: "accrualYear",               type: "number" },
  isActive:     { prismaPath: "employee.isActive",         type: "boolean" },
};

export const leaveBalanceSource: DataSourceDefinition = {
  id: "LEAVE_BALANCE",
  label: "Time off balances",
  description: "How much time off each employee has earned, used and has left.",
  icon: "Wallet",
  columns: [
    { id: "employeeName",   label: "Employee",       type: "string",  defaultVisible: true },
    { id: "employeeCode",   label: "Badge ID",       type: "string",  defaultVisible: false },
    { id: "department",     label: "Department",      type: "string",  defaultVisible: true },
    { id: "site",           label: "Site",            type: "string",  defaultVisible: false },
    { id: "leaveType",      label: "Time off type",      type: "string",  defaultVisible: true },
    { id: "accrualYear",    label: "Year",            type: "number",  defaultVisible: true },
    { id: "earnedMinutes",  label: "Earned",    type: "number",  defaultVisible: true },
    { id: "usedMinutes",    label: "Used",      type: "number",  defaultVisible: true },
    // What is left. The stored balance already has the used time taken off;
    // "Remaining" took it off again, and 1,016 of 2,678 rows read negative.
    { id: "remainingMinutes", label: "Remaining", type: "number", defaultVisible: true, total: false },
    { id: "balanceMinutes", label: "Balance (same as Remaining)", type: "number", defaultVisible: false, total: false },
    { id: "status",         label: "Status",    type: "string",  defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "leaveTypeId", label: "Time off type", type: "string", operators: ["eq", "in"] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
    { id: "accrualYear", label: "Year", type: "number", operators: ["eq"] },
    { id: "isActive", label: "Status", type: "boolean", operators: ["eq"],
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ] },
  ],
  groupableFields: ["employeeName", "department", "site", "leaveType", "status"],
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
        employee: { include: { user: true, department: true, site: true } },
        leaveType: true,
      },
      orderBy: [
        { employee: { user: { name: "asc" } } },
        { leaveType: { name: "asc" } },
      ],
    });

    // Earned in each balance's year, from the ledger, by posting day (see time-off-history).
    const years = [...new Set(balances.map((b) => b.accrualYear))];
    const earned = balances.length
      ? await db.$queryRaw<{ employeeId: string; leaveTypeId: string; year: number; minutes: number }[]>`
          SELECT "employeeId", "leaveTypeId",
                 EXTRACT(YEAR FROM COALESCE("payPeriodEnd", ("createdAt" AT TIME ZONE 'America/New_York')::date))::int AS year,
                 SUM("deltaMinutes")::int AS minutes
          FROM leave_accrual_ledger
          WHERE "employeeId" = ANY(${[...new Set(balances.map((b) => b.employeeId))]})
            AND action::text IN ('ACCRUAL', 'EARNED_ADJUSTMENT')
            AND EXTRACT(YEAR FROM COALESCE("payPeriodEnd", ("createdAt" AT TIME ZONE 'America/New_York')::date))::int = ANY(${years})
          GROUP BY 1, 2, 3`
      : [];
    const earnedBy = new Map(earned.map((e) => [`${e.employeeId}|${e.leaveTypeId}|${e.year}`, e.minutes]));

    const rows = balances.map((b) => ({
      employeeName: b.employee.user?.name ?? b.employee.employeeCode,
      employeeCode: b.employee.wmsId ?? b.employee.employeeCode,
      department: b.employee.department.name,
      leaveType: b.leaveType.name,
      accrualYear: b.accrualYear,
      site: b.employee.site.name,
      earnedMinutes: earnedBy.get(`${b.employeeId}|${b.leaveTypeId}|${b.accrualYear}`) ?? 0,
      balanceMinutes: b.balanceMinutes,
      usedMinutes: b.usedMinutes,
      remainingMinutes: b.balanceMinutes,
      status: b.employee.isActive ? "Active" : "Inactive",
    }));

    // Every sort in memory, then the limit: taken in the database first, a
    // sort on a worked-out column only ever sorted the first rows.
    const sorted = sortRowsInMemory(rows, config.sortBy, {});
    const sortedRows = config.limit ? sorted.slice(0, config.limit) : sorted;

    const colById = Object.fromEntries(leaveBalanceSource.columns.map((c) => [c.id, c]));
    const visibleColumns = config.columns.map((id) => colById[id]).filter(Boolean);

    return {
      columns: visibleColumns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: sortedRows,
      totalRows: sorted.length,
    };
  },
};
