import { Prisma, type PayFrequency } from "@prisma/client";
import { db } from "@/lib/db";
import { periodDayRange } from "@/lib/pay-period-days";
import { readable } from "../readable";
import { timesheetPayPeriodWhere } from "../date-scope";
import { daysOf, describeSpan, type DaySpan } from "../period";
import type { DataSourceDefinition, ExecuteContext, ReportResult } from "./index";
import { buildWhereClause, buildOrderBy, sortRowsInMemory, type FieldMap } from "../query-builder";
import type { ReportConfig } from "@/lib/validators/report.schema";

const fieldMap: FieldMap = {
  employeeName:  { prismaPath: "employee.user.name",       type: "string" },
  employeeCode:  { prismaPath: "employee.wmsId",           type: "string" },
  department:    { prismaPath: "employee.department.name",  type: "string" },
  departmentId:  { prismaPath: "employee.departmentId",     type: "string" },
  site:          { prismaPath: "employee.site.name",        type: "string" },
  siteId:        { prismaPath: "employee.siteId",           type: "string" },
  status:        { prismaPath: "status",                    type: "string" },
  payPeriodId:   { prismaPath: "payPeriodId",               type: "string" },
};

export const hoursSummarySource: DataSourceDefinition = {
  id: "HOURS_SUMMARY",
  label: "Hours summary",
  description: "Regular, overtime and double time hours for each employee, with their PTO balance.",
  icon: "Clock",
  columns: [
    { id: "employeeName",  label: "Employee",   type: "string",  defaultVisible: true },
    { id: "employeeCode",  label: "Badge ID",   type: "string",  defaultVisible: false },
    { id: "department",    label: "Department",  type: "string",  defaultVisible: true },
    { id: "site",          label: "Site",        type: "string",  defaultVisible: true },
    { id: "regMinutes",    label: "Regular",         type: "number",  defaultVisible: true },
    { id: "otMinutes",     label: "Overtime",          type: "number",  defaultVisible: true },
    { id: "dtMinutes",     label: "Double time",          type: "number",  defaultVisible: true },
    { id: "ptoMinutes",    label: "PTO balance",         type: "number",  defaultVisible: true },
    { id: "sickMinutes",   label: "Sick",        type: "number",  defaultVisible: false },
    { id: "holidayMinutes",label: "Holiday",     type: "number",  defaultVisible: false },
    { id: "totalMinutes",  label: "Total",       type: "number",  defaultVisible: true },
    { id: "premiumMinutes", label: "Meal premium", type: "number", defaultVisible: false },
    { id: "status",        label: "Timesheet status",      type: "string",  defaultVisible: true },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "status", label: "Timesheet status", type: "string", operators: ["eq", "in"],
      options: [
        { value: "OPEN", label: "Open" },
        { value: "LOCKED", label: "Locked" },
      ] },
  ],
  groupableFields: ["department", "site"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    // Dates rather than a pay period: the hours worked on those days.
    if (config.dateRange.type !== "payPeriod") {
      return hoursOnDays(config, tenantId, daysOf(config.dateRange, ctx?.timezone, ctx?.now));
    }

    const dateWhere = await timesheetPayPeriodWhere(config.dateRange, tenantId);
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

    // Get PTO balances for the relevant employees. This is what each person
    // has left this year, not PTO taken in the period, hence "PTO balance".
    const ptoByEmployee = await ptoBalances(timesheets.map((ts) => ts.employeeId));

    // Meal premiums: an hour of pay each, not hours worked, so not in Regular or Total.
    const timesheetIds = timesheets.map((ts) => ts.id);
    const premiums =
      timesheetIds.length > 0
        ? await db.workSegment.groupBy({
            by: ["timesheetId"],
            where: { timesheetId: { in: timesheetIds }, segmentType: "MEAL_PREMIUM", isPaid: true },
            _sum: { durationMinutes: true },
          })
        : [];
    const premiumByTimesheet = new Map(premiums.map((p) => [p.timesheetId, p._sum.durationMinutes ?? 0]));

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
        employeeCode: ts.employee.wmsId ?? ts.employee.employeeCode,
        department: ts.employee.department.name,
        site: ts.employee.site.name,
        regMinutes: reg,
        otMinutes: ot,
        dtMinutes: dt,
        ptoMinutes: pto,
        sickMinutes: sick,
        holidayMinutes: holiday,
        totalMinutes: reg + ot + dt,
        premiumMinutes: premiumByTimesheet.get(ts.id) ?? 0,
        status: readable("timesheetStatus", ts.status),
      };
    });

    // In-memory sort for computed columns (regMinutes, otMinutes, etc.)
    const sortedRows = sortRowsInMemory(rows, config.sortBy, fieldMap);

    // Select only requested columns
    const colById = Object.fromEntries(hoursSummarySource.columns.map((c) => [c.id, c]));
    const visibleColumns = config.columns.map((id) => colById[id]).filter(Boolean);

    return {
      columns: visibleColumns.map((c) => ({
        id: c.id,
        label: c.label,
        type: c.type,
      })),
      rows: sortedRows,
      totalRows: sortedRows.length,
    };
  },
};

// ─── Hours on chosen days ───────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const utcDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * The hours worked on a run of days, one row per person, however their pay
 * periods fall. "Last week" used to count only the pay periods that fit
 * inside it, which left out everyone paid every two weeks. The hours are the
 * timecard's own lines added up by the day they are dated, as Daily hours
 * counts them, so the two reports agree on any run of days.
 *
 * <p>Who is in: everyone with a timesheet whose pay period touches the days,
 * so a person with no hours shows with zeros, as they do for a pay period.
 * Overtime is the overtime earned on those days; a week's overtime that
 * started on a day outside them is not in.
 */
async function hoursOnDays(config: ReportConfig, tenantId: string, span: DaySpan): Promise<ReportResult> {
  const filterWhere = buildWhereClause(config.filters, fieldMap) as Record<string, unknown>;
  const employeeFilter = (filterWhere.employee as Record<string, unknown>) ?? {};
  const statuses = statusesOf(filterWhere.status);
  const period = { start: span.start, end: span.end, label: describeSpan(span) };
  const colById = Object.fromEntries(hoursSummarySource.columns.map((c) => [c.id, c]));
  const columns = config.columns
    .map((id) => colById[id])
    .filter(Boolean)
    .map((c) => ({ id: c.id, label: c.label, type: c.type }));

  // The pay periods that touch the days. Their stored dates do not say their
  // last day on their own (see pay-period-days), so they are read here.
  const candidates = await db.payPeriod.findMany({
    where: {
      tenantId,
      startDate: { lt: new Date(utcDate(span.end).getTime() + DAY_MS) },
      endDate: { gte: new Date(utcDate(span.start).getTime() - DAY_MS) },
    },
    select: { id: true, startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } },
  });
  const periodIds = candidates
    .filter((p) => {
      const { firstDay, lastDay } = periodDayRange(p, (p.ruleSet?.payFrequency ?? p.tenant.payFrequency) as PayFrequency);
      return firstDay <= span.end && lastDay >= span.start;
    })
    .map((p) => p.id);
  if (periodIds.length === 0) return { columns, rows: [], totalRows: 0, period };

  const timesheetWhere = {
    payPeriodId: { in: periodIds },
    ...(filterWhere.status !== undefined ? { status: filterWhere.status } : {}),
  } as Prisma.TimesheetWhereInput;

  const people = await db.employee.findMany({
    where: { tenantId, ...employeeFilter, timesheets: { some: timesheetWhere } } as Prisma.EmployeeWhereInput,
    select: {
      id: true, wmsId: true, employeeCode: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
      site: { select: { name: true } },
      timesheets: { where: timesheetWhere, select: { status: true } },
    },
  });
  if (people.length === 0) return { columns, rows: [], totalRows: 0, period };
  const ids = people.map((p) => p.id);

  // Added up in the database, by person and kind of hours.
  const sums = await db.$queryRaw<{ employeeId: string; segmentType: string; payBucket: string; isPaid: boolean; minutes: number }[]>`
    SELECT t."employeeId", s."segmentType"::text AS "segmentType", s."payBucket"::text AS "payBucket", s."isPaid",
           SUM(s."durationMinutes")::float8 AS minutes
    FROM work_segments s
    JOIN timesheets t ON t.id = s."timesheetId"
    WHERE s."segmentDate" BETWEEN ${utcDate(span.start)}::date AND ${utcDate(span.end)}::date
      AND t."employeeId" = ANY(${ids})
      ${statuses ? Prisma.sql`AND t.status::text = ANY(${statuses})` : Prisma.empty}
    GROUP BY 1, 2, 3, 4`;

  // The same lines the pay period totals are built from: worked time by its
  // bucket, sick leave, holidays, and paid meal premiums on their own.
  const hours = new Map<string, { reg: number; ot: number; dt: number; sick: number; holiday: number; premium: number }>();
  for (const s of sums) {
    const h = hours.get(s.employeeId) ?? { reg: 0, ot: 0, dt: 0, sick: 0, holiday: 0, premium: 0 };
    const m = Number(s.minutes) || 0;
    if (s.segmentType === "WORK") {
      if (s.payBucket === "REG") h.reg += m;
      else if (s.payBucket === "OT") h.ot += m;
      else if (s.payBucket === "DT") h.dt += m;
    } else if (s.segmentType === "LEAVE" && s.payBucket === "SICK") h.sick += m;
    else if (s.segmentType === "HOLIDAY") h.holiday += m;
    else if (s.segmentType === "MEAL_PREMIUM" && s.isPaid) h.premium += m;
    hours.set(s.employeeId, h);
  }

  const pto = await ptoBalances(ids);

  const rows = people.map((p) => {
    const h = hours.get(p.id) ?? { reg: 0, ot: 0, dt: 0, sick: 0, holiday: 0, premium: 0 };
    const states = [...new Set(p.timesheets.map((t) => readable("timesheetStatus", t.status)))].sort();
    return {
      employeeName: p.user?.name ?? p.employeeCode,
      employeeCode: p.wmsId ?? p.employeeCode,
      department: p.department.name,
      site: p.site.name,
      regMinutes: h.reg,
      otMinutes: h.ot,
      dtMinutes: h.dt,
      ptoMinutes: pto[p.id] ?? 0,
      sickMinutes: h.sick,
      holidayMinutes: h.holiday,
      totalMinutes: h.reg + h.ot + h.dt,
      premiumMinutes: h.premium,
      // The days can cross two timesheets, one locked and one still open.
      status: states.join(" and "),
    };
  });

  rows.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)));
  const sorted = sortRowsInMemory(rows, config.sortBy, {});
  const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
  return { columns, rows: limited, totalRows: sorted.length, period };
}

/** The statuses a Timesheet status filter keeps, or null for no filter. */
function statusesOf(where: unknown): string[] | null {
  if (where === undefined) return null;
  if (typeof where === "string") return [where];
  const list = (where as { in?: unknown }).in;
  if (Array.isArray(list)) return list.map(String);
  // Only "is" and "is any of" are offered for status.
  throw new Error("Unsupported timesheet status filter.");
}

/** What each person has left of their PTO this year, in minutes. */
async function ptoBalances(employeeIds: string[]): Promise<Record<string, number>> {
  if (employeeIds.length === 0) return {};
  const balances = await db.leaveBalance.findMany({
    where: { employeeId: { in: employeeIds }, leaveType: { category: "PTO" }, accrualYear: new Date().getFullYear() },
    select: { employeeId: true, balanceMinutes: true },
  });
  const out: Record<string, number> = {};
  for (const b of balances) out[b.employeeId] = (out[b.employeeId] ?? 0) + b.balanceMinutes;
  return out;
}
