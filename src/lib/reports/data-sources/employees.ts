import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, filterRowsInMemory, sortRowsInMemory, type FieldMap } from "../query-builder";
import { periodDayRange } from "@/lib/pay-period-days";
import { daysOf } from "../period";
import type { ReportConfig } from "@/lib/validators/report.schema";
import { personTimeZone, timeZoneLabel } from "@/lib/utils/person-time-zone";
import { rateInEffect, todayKey } from "@/lib/pay-rates";

/**
 * Employees: one row per person, with their setup. The source HR's lists are
 * built from: the employee listing and profile, new hires (filter the hire
 * date), who reports to whom (group by supervisor), who has stopped coming in
 * (filter the days since the last punch), job and pay rates, and the setup
 * groups (site, department, agency, rule set, shift, pay category).
 *
 * <p>The report's dates only feed the two "in these dates" columns, hours and
 * days worked, so a list of people is not cut down by them. Inactive people are
 * left out unless the Status filter asks for them.
 */

const fieldMap: FieldMap = {
  employeeName: { prismaPath: "user.name", type: "string" },
  employeeCode: { prismaPath: "wmsId", type: "string" },
  isActive: { prismaPath: "isActive", type: "boolean" },
  siteId: { prismaPath: "siteId", type: "string" },
  departmentId: { prismaPath: "departmentId", type: "string" },
  agencyId: { prismaPath: "agencyId", type: "string" },
  supervisorId: { prismaPath: "supervisorId", type: "string" },
  ruleSetId: { prismaPath: "ruleSetId", type: "string" },
  shiftId: { prismaPath: "shiftId", type: "string" },
  payCategoryId: { prismaPath: "payCategoryId", type: "string" },
  payType: { prismaPath: "payType", type: "string" },
  hireDate: { prismaPath: "hireDate", type: "date" },
  terminatedAt: { prismaPath: "terminatedAt", type: "date" },
  jobTitle: { prismaPath: "jobTitleRef.name", type: "string" },
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** The days the report's dates stand for, as yyyy-MM-dd. */
async function rangeDays(range: ReportConfig["dateRange"], tenantId: string): Promise<{ first: string; last: string } | null> {
  if (range.type === "payPeriod") {
    const p = await db.payPeriod.findFirst({
      where: { id: range.payPeriodId, tenantId },
      select: { startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } },
    });
    if (!p) return null;
    const r = periodDayRange(p, p.ruleSet?.payFrequency ?? p.tenant.payFrequency);
    return { first: r.firstDay, last: r.lastDay };
  }
  const span = daysOf(range);
  return { first: span.start, last: span.end };
}

export const employeesSource: DataSourceDefinition = {
  id: "EMPLOYEES",
  label: "Employees",
  description: "Each employee's setup: site, department, agency, supervisor, rule set, shift, pay and dates, with their last punch.",
  icon: "Users",
  columns: [
    { id: "employeeName", label: "Employee", type: "string", defaultVisible: true },
    { id: "employeeCode", label: "Badge ID", type: "string", defaultVisible: true },
    { id: "status", label: "Status", type: "string", defaultVisible: true },
    { id: "site", label: "Site", type: "string", defaultVisible: true },
    { id: "department", label: "Department", type: "string", defaultVisible: true },
    { id: "agency", label: "Agency", type: "string", defaultVisible: true },
    { id: "jobTitle", label: "Job title", type: "string" },
    { id: "supervisor", label: "Supervisor", type: "string", defaultVisible: true },
    { id: "role", label: "Role", type: "string" },
    { id: "ruleSet", label: "Rule set", type: "string" },
    { id: "shift", label: "Shift", type: "string" },
    { id: "holidayRule", label: "Holiday rule", type: "string" },
    { id: "payCategory", label: "Pay category", type: "string" },
    { id: "flsaType", label: "FLSA type", type: "string" },
    { id: "payType", label: "Hourly or salary", type: "string" },
    { id: "payRate", label: "Pay rate", type: "number" },
    { id: "markupPct", label: "Charge markup %", type: "number" },
    { id: "chargeRate", label: "Charge rate", type: "number" },
    { id: "hireDate", label: "Hire date", type: "date", defaultVisible: true },
    { id: "adjustedHireDate", label: "Adjusted hire date", type: "date" },
    { id: "terminatedAt", label: "Termination date", type: "date" },
    { id: "terminationReason", label: "Termination reason", type: "string" },
    { id: "timeZone", label: "Time zone", type: "string" },
    { id: "email", label: "Email", type: "string" },
    { id: "lastPunch", label: "Last punch", type: "string" },
    { id: "daysSinceLastPunch", label: "Days since last punch", type: "number", exportLabel: "Days since last punch (or hire, if never)" },
    { id: "hoursInRange", label: "Hours worked in these dates", type: "number", total: true },
    { id: "daysWorkedInRange", label: "Days worked in these dates", type: "number", total: true },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
    {
      id: "isActive",
      label: "Status",
      type: "boolean",
      operators: ["eq"],
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
    },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "agencyId", label: "Agency", type: "string", operators: ["eq", "in"] },
    { id: "supervisorId", label: "Supervisor", type: "string", operators: ["eq", "in"] },
    { id: "ruleSetId", label: "Rule set", type: "string", operators: ["eq", "in"] },
    { id: "shiftId", label: "Shift", type: "string", operators: ["eq", "in"] },
    { id: "payCategoryId", label: "Pay category", type: "string", operators: ["eq", "in"] },
    {
      id: "payType",
      label: "Hourly or salary",
      type: "string",
      operators: ["eq"],
      options: [
        { value: "HOURLY", label: "Hourly" },
        { value: "SALARY", label: "Salary" },
      ],
    },
    { id: "jobTitle", label: "Job title", type: "string", operators: ["contains", "eq"] },
    { id: "hireDate", label: "Hire date", type: "date", operators: ["inRange", "between", "gte", "lte"] },
    { id: "terminatedAt", label: "Termination date", type: "date", operators: ["inRange", "between", "gte", "lte"] },
    { id: "daysSinceLastPunch", label: "Days since last punch", type: "number", operators: ["gte", "lte", "between"] },
    { id: "daysWorkedInRange", label: "Days worked in these dates", type: "number", operators: ["gte", "lte", "between"] },
    { id: "hoursInRange", label: "Hours worked in these dates", type: "number", operators: ["gte", "lte", "between"] },
  ],
  groupableFields: ["status", "site", "department", "agency", "supervisor", "ruleSet", "shift", "payCategory", "payType"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const span = await rangeDays(config.dateRange, tenantId);
    // "Hire date is in the report dates": the report's own days, read now.
    const filters = config.filters.map((f) =>
      f.operator === "inRange"
        ? span
          ? { ...f, operator: "between" as const, value: span.first, value2: span.last }
          : { ...f, operator: "eq" as const, value: "0001-01-01" }
        : f
    );
    const filterWhere = buildWhereClause(filters, fieldMap);
    // Columns worked out below (last punch, days worked) are filtered and
    // sorted after they are, so the row limit can only be applied then:
    // taken first, a preview kept the first 100 by name and filtered those.
    const afterwards =
      config.sortBy.length > 0 || filters.some((f) => !fieldMap[f.field]);
    // Current employees unless the Status filter says otherwise.
    const statusFiltered = config.filters.some((f) => f.field === "isActive");

    const employees = await db.employee.findMany({
      where: { tenantId, ...(statusFiltered ? {} : { isActive: true }), ...filterWhere },
      select: {
        id: true,
        wmsId: true,
        employeeCode: true,
        isActive: true,
        onLeave: true,
        payType: true,
        payRate: true,
        hireDate: true,
        adjustedHireDate: true,
        terminatedAt: true,
        terminationReason: true,
        timeZone: true,
        jobTitle: true,
        user: { select: { name: true, email: true } },
        site: { select: { name: true, timezone: true } },
        department: { select: { name: true } },
        agencyRef: { select: { code: true, description: true } },
        jobTitleRef: { select: { name: true } },
        supervisor: { select: { user: { select: { name: true } } } },
        customRole: { select: { name: true } },
        ruleSet: { select: { name: true } },
        shift: { select: { name: true } },
        holidayRule: { select: { name: true } },
        payCategory: { select: { number: true, description: true } },
        payTypeLookup: { select: { number: true, description: true } },
        payRates: { select: { effectiveDate: true, rate1: true, markupPct: true, chargeRate: true } },
      },
      orderBy: { user: { name: "asc" } },
      take: afterwards ? undefined : config.limit,
    });
    const ids = employees.map((e) => e.id);

    // The last punch, whenever it was, and the hours and days worked in the report's dates.
    const now = Date.now();
    const [lastPunches, worked] = await Promise.all([
      ids.length
        ? db.punch.groupBy({
            by: ["employeeId"],
            where: { employeeId: { in: ids }, isApproved: true, correctedById: null },
            _max: { punchTime: true },
          })
        : Promise.resolve([]),
      (async () => {
        if (!span || !ids.length) return [] as { e: string; m: number; d: number }[];
        return db.$queryRaw<{ e: string; m: number; d: number }[]>`
          select t."employeeId" e, sum(w."durationMinutes")::int m, count(distinct w."segmentDate")::int d
          from work_segments w join timesheets t on t.id = w."timesheetId"
          where w."segmentType" = 'WORK' and w."isPaid" and w."durationMinutes" > 0
            and w."segmentDate" between ${span.first}::date and ${span.last}::date
            and t."employeeId" = any(${ids})
          group by 1`;
      })(),
    ]);
    const lastBy = new Map(lastPunches.map((p) => [p.employeeId, p._max.punchTime]));
    const workedBy = new Map(worked.map((w) => [w.e, w]));

    const today = todayKey();
    const rows = employees.map((e) => {
      const last = lastBy.get(e.id) ?? null;
      // The pay rate row in effect today, for its markup and charge rate.
      const rateRow = rateInEffect(e.payRates, today);
      const zone = personTimeZone(e);
      const w = workedBy.get(e.id);
      return {
        employeeName: e.user?.name ?? e.employeeCode,
        employeeCode: e.wmsId ?? e.employeeCode,
        status: !e.isActive ? "Inactive" : e.onLeave ? "On leave" : "Active",
        site: e.site.name,
        department: e.department.name,
        agency: e.agencyRef ? `${e.agencyRef.code} ${e.agencyRef.description}` : null,
        jobTitle: e.jobTitleRef?.name ?? e.jobTitle ?? null,
        supervisor: e.supervisor?.user?.name ?? null,
        role: e.customRole?.name ?? null,
        ruleSet: e.ruleSet.name,
        shift: e.shift?.name ?? null,
        holidayRule: e.holidayRule?.name ?? null,
        payCategory: e.payCategory ? `${e.payCategory.number} ${e.payCategory.description?.trim() ?? ""}`.trim() : null,
        flsaType: e.payTypeLookup ? `${e.payTypeLookup.number} ${e.payTypeLookup.description ?? ""}`.trim() : null,
        payType: e.payType === "SALARY" ? "Salary" : e.payType === "HOURLY" ? "Hourly" : null,
        payRate: e.payRate != null ? Number(e.payRate) : null,
        markupPct: rateRow?.markupPct != null ? Number(rateRow.markupPct) : null,
        chargeRate: rateRow?.chargeRate != null ? Number(rateRow.chargeRate) : null,
        hireDate: day(e.hireDate),
        adjustedHireDate: day(e.adjustedHireDate),
        terminatedAt: day(e.terminatedAt),
        terminationReason: e.terminationReason ?? null,
        timeZone: e.timeZone ? timeZoneLabel(e.timeZone) : `Site's (${timeZoneLabel(e.site.timezone)})`,
        email: e.user?.email ?? null,
        lastPunch: last
          ? new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" }).format(last)
          : "Never",
        // Someone who has never punched counts from their hire date, so they
        // are found by "no punch in 14 days" as NovaTime's inactive list finds them.
        daysSinceLastPunch: Math.max(0, Math.floor((now - (last ?? e.hireDate).getTime()) / 86_400_000)),
        hoursInRange: w ? Math.round((w.m / 60) * 100) / 100 : 0,
        daysWorkedInRange: w ? w.d : 0,
      };
    });

    // Days since the last punch is worked out above, so its filter is applied
    // here. Every sort is too: the rows are built, so a hire date sorts as
    // readily as a name, where the database sort only ever used the name.
    const filtered = filterRowsInMemory(rows, filters, fieldMap);
    const sorted = sortRowsInMemory(filtered, config.sortBy, {});
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;

    const colById = Object.fromEntries(employeesSource.columns.map((c) => [c.id, c]));
    const visible = config.columns.map((id) => colById[id]).filter(Boolean);
    return {
      columns: visible.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows: limited,
      totalRows: sorted.length,
    };
  },
};
