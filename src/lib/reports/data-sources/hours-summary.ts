import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "employee.employeeCode",    type: "string" },
  department:    { prismaPath: "employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "employee.departmentId",     type: "string" },
  site:          { prismaPath: "employee.site.name",        type: "string" },
  siteId:        { prismaPath: "employee.siteId",           type: "string" },
  status:        { prismaPath: "status",                    type: "string" },
  payPeriodId:   { prismaPath: "payPeriodId",               type: "string" },
};

export const hoursSummarySource: DataSourceDefinition = {
  id: "HOURS_SUMMARY",
  label: "Hours Summary",
  description: "Hours by employee for a pay period or date range — REG, OT, DT, and leave buckets.",
  icon: "Clock",
  columns: [
    { id: "employeeName",  label: "Employee",   type: "string",  defaultVisible: true },
    { id: "employeeCode",  label: "Emp Code",   type: "string",  defaultVisible: false },
    { id: "department",    label: "Department",  type: "string",  defaultVisible: true },
    { id: "site",          label: "Site",        type: "string",  defaultVisible: true },
    { id: "regMinutes",    label: "REG",         type: "number",  defaultVisible: true },
    { id: "otMinutes",     label: "OT",          type: "number",  defaultVisible: true },
    { id: "dtMinutes",     label: "DT",          type: "number",  defaultVisible: true },
    { id: "ptoMinutes",    label: "PTO",         type: "number",  defaultVisible: true },
    { id: "sickMinutes",   label: "Sick",        type: "number",  defaultVisible: false },
    { id: "holidayMinutes",label: "Holiday",     type: "number",  defaultVisible: false },
    { id: "totalMinutes",  label: "Total",       type: "number",  defaultVisible: true },
    { id: "status",        label: "Status",      type: "string",  defaultVisible: true },
  ],
  filters: [
    { id: "employeeName", label: "Employee Name", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "status", label: "Timesheet Status", type: "string", operators: ["eq", "in"],
      options: [
        { value: "OPEN", label: "Open" },
        { value: "SUBMITTED", label: "Submitted" },
        { value: "SUP_APPROVED", label: "Supervisor Approved" },
        { value: "PAYROLL_APPROVED", label: "Payroll Approved" },
        { value: "LOCKED", label: "Locked" },
      ] },
  ],
  groupableFields: ["department", "site"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    // Build date-based where clause
    const dateWhere = await resolveDateRange(config.dateRange, tenantId);
    const filterWhere = buildWhereClause(config.filters, fieldMap);

    const where = {
      ...dateWhere,
      ...filterWhere,
      employee: {
        tenantId,
        ...(filterWhere.employee as Record<string, unknown> ?? {}),
      },
    };

    const orderBy =
      config.sortBy.length > 0
        ? buildOrderBy(config.sortBy, fieldMap)
        : [{ employee: { user: { name: "asc" as const } } }];

    const timesheets = await db.timesheet.findMany({
      where,
      include: {
        employee: { include: { user: true, department: true, site: true } },
        overtimeBuckets: true,
      },
      orderBy,
      take: config.limit,
    });

    // Get PTO balances for the relevant employees
    const employeeIds = timesheets.map((ts) => ts.employeeId);
    const year = new Date().getFullYear();

    const ptoBalances =
      employeeIds.length > 0
        ? await db.leaveBalance.findMany({
            where: {
              employeeId: { in: employeeIds },
              leaveType: { category: "PTO" },
              accrualYear: year,
            },
          })
        : [];

    const ptoByEmployee: Record<string, number> = {};
    for (const bal of ptoBalances) {
      ptoByEmployee[bal.employeeId] =
        (ptoByEmployee[bal.employeeId] ?? 0) + bal.balanceMinutes;
    }

    // Build rows
    const rows = timesheets.map((ts) => {
      const buckets: Record<string, number> = {};
      for (const b of ts.overtimeBuckets) {
        buckets[b.bucket] = b.totalMinutes;
      }

      const reg = buckets["REG"] ?? 0;
      const ot = buckets["OT"] ?? 0;
      const dt = buckets["DT"] ?? 0;
      const pto = ptoByEmployee[ts.employeeId] ?? 0;
      const sick = buckets["SICK"] ?? 0;
      const holiday = buckets["HOLIDAY"] ?? 0;

      return {
        employeeName: ts.employee.user?.name ?? ts.employeeId,
        employeeCode: ts.employee.employeeCode,
        department: ts.employee.department.name,
        site: ts.employee.site.name,
        regMinutes: reg,
        otMinutes: ot,
        dtMinutes: dt,
        ptoMinutes: pto,
        sickMinutes: sick,
        holidayMinutes: holiday,
        totalMinutes: reg + ot + dt,
        status: ts.status,
      };
    });

    // Select only requested columns
    const visibleColumns = hoursSummarySource.columns.filter((c) =>
      config.columns.includes(c.id)
    );

    return {
      columns: visibleColumns.map((c) => ({
        id: c.id,
        label: c.label,
        type: c.type,
      })),
      rows,
      totalRows: rows.length,
    };
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function resolveDateRange(
  dateRange: ReportConfig["dateRange"],
  tenantId: string
): Promise<Record<string, unknown>> {
  switch (dateRange.type) {
    case "payPeriod":
      return { payPeriodId: dateRange.payPeriodId };

    case "custom": {
      const start = new Date(dateRange.startDate);
      const end = new Date(dateRange.endDate);
      return {
        payPeriod: {
          tenantId,
          startDate: { gte: start },
          endDate: { lte: end },
        },
      };
    }

    case "relative": {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - dateRange.relativeDays);
      return {
        payPeriod: {
          tenantId,
          startDate: { gte: start },
          endDate: { lte: now },
        },
      };
    }
  }
}
