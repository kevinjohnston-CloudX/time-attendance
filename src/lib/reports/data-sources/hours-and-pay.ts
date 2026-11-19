import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, filterRowsInMemory, sortRowsInMemory, type FieldMap } from "../query-builder";
import { periodDayRange } from "@/lib/pay-period-days";
import { daysOf, describeSpan, type DaySpan } from "../period";
import { rateInEffect } from "@/lib/pay-rates";
import { lastNameFirst } from "../last-name-first";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * Hours and pay: each person's paid hours for the dates, by kind, and what
 * they are paid for them. Payroll's backup for a pay period, the way Bergen
 * Canada keeps it (Tony Deroy, 2026-11-18): an agency's people weekly, and
 * the company's own people, hourly and salaried together, every two weeks.
 *
 * <p>Salaried people's worked time is their Salary hours, everyone else's is
 * Regular. Holiday is the time card's holiday pay code and Paid time off is
 * paid leave of any kind; unpaid time is left out. Total hours is every paid
 * hour, and Total pay prices each kind at the person's Rate 1: overtime and
 * double time at their rule set's multipliers, everything else at the rate.
 * A raise inside the dates prices each day at the rate in effect on it.
 *
 * <p>Pay is worked out from the exact minutes and rounded to the cent once,
 * as NovaTime's own pay figures are: 6 hours 38 minutes of overtime at
 * $27.54 is $274.02, not the $273.89 that the 6.63 shown would give
 * (checked against Tony's Week 2645 backup). Pay is left blank for anyone
 * with paid hours on a day that has no rate, rather than shown short. A salaried Rate 1 is an hourly amount in every record
 * today; one that reads as a yearly salary (1,000 or more) is not priced.
 *
 * <p>The dates read "Pay period" when they are exactly the pay period of
 * every person in the report, which is what payroll files the backup under.
 */

const fieldMap: FieldMap = {
  employeeName: { prismaPath: "user.name", type: "string" },
  employeeCode: { prismaPath: "wmsId", type: "string" },
  siteId: { prismaPath: "siteId", type: "string" },
  departmentId: { prismaPath: "departmentId", type: "string" },
  agencyId: { prismaPath: "agencyId", type: "string" },
  payType: { prismaPath: "payType", type: "string" },
};

/** A Rate 1 this large is a yearly salary, not an hourly rate. */
const YEARLY_RATE = 1000;

type Kind = "REG" | "OT" | "DT" | "HOLIDAY" | "LEAVE";

const cents = (n: number) => Math.round(n * 100) / 100;

async function rangeDays(range: ReportConfig["dateRange"], tenantId: string): Promise<DaySpan | null> {
  if (range.type === "payPeriod") {
    const p = await db.payPeriod.findFirst({
      where: { id: range.payPeriodId, tenantId },
      select: { startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } },
    });
    if (!p) return null;
    const r = periodDayRange(p, p.ruleSet?.payFrequency ?? p.tenant.payFrequency);
    return { start: r.firstDay, end: r.lastDay };
  }
  return daysOf(range);
}

/**
 * "Pay period Oct 25 to Nov 7, 2026" when the dates are exactly the pay
 * period every listed person is paid on; otherwise just the dates.
 */
async function periodLabel(span: DaySpan, employeeIds: string[]): Promise<string> {
  const dates = describeSpan(span);
  if (employeeIds.length === 0) return dates;
  const sheets = await db.timesheet.findMany({
    where: {
      employeeId: { in: employeeIds },
      payPeriod: {
        startDate: { lt: new Date(Date.parse(`${span.end}T00:00:00Z`) + 2 * 86_400_000) },
        endDate: { gt: new Date(Date.parse(`${span.start}T00:00:00Z`) - 86_400_000) },
      },
    },
    select: {
      employeeId: true,
      payPeriod: { select: { startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } } },
    },
  });
  const exact = new Set<string>();
  for (const s of sheets) {
    const p = s.payPeriod;
    const r = periodDayRange(p, p.ruleSet?.payFrequency ?? p.tenant.payFrequency);
    if (r.firstDay === span.start && r.lastDay === span.end) exact.add(s.employeeId);
  }
  return employeeIds.every((id) => exact.has(id)) ? `Pay period ${dates}` : dates;
}

export const hoursAndPaySource: DataSourceDefinition = {
  id: "HOURS_AND_PAY",
  label: "Hours and pay",
  description: "Each person's paid hours for the dates by kind (salary, regular, overtime, holiday, paid time off) and their pay at their rate, with totals. Payroll's backup for a pay period.",
  icon: "Wallet",
  columns: [
    { id: "employeeName", label: "Employee", type: "string", defaultVisible: true },
    { id: "employeeCode", label: "Badge ID", type: "string", defaultVisible: true },
    { id: "agency", label: "Agency", type: "string", defaultVisible: false },
    { id: "site", label: "Site", type: "string", defaultVisible: false },
    { id: "department", label: "Department", type: "string", defaultVisible: true },
    { id: "payType", label: "Hourly or salary", type: "string", defaultVisible: false },
    { id: "salaryMinutes", label: "Salary", type: "number", defaultVisible: true },
    { id: "regMinutes", label: "Regular", type: "number", defaultVisible: true },
    { id: "otMinutes", label: "Overtime", type: "number", defaultVisible: true },
    { id: "dtMinutes", label: "Double time", type: "number", defaultVisible: false },
    { id: "holidayMinutes", label: "Holiday", type: "number", defaultVisible: true },
    { id: "ptoMinutes", label: "Paid time off", type: "number", defaultVisible: true },
    { id: "totalMinutes", label: "Total hours", type: "number", defaultVisible: true },
    { id: "payCost", label: "Total pay", type: "number", defaultVisible: true, total: true },
    { id: "payRate", label: "Rate", type: "number", defaultVisible: true },
    { id: "unratedMinutes", label: "Hours with no pay rate", type: "number", defaultVisible: false },
  ],
  filters: [
    { id: "agencyId", label: "Agency", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
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
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
    { id: "status", label: "Timesheet status", type: "string", operators: ["eq", "in"],
      options: [
        { value: "OPEN", label: "Open" },
        { value: "LOCKED", label: "Locked" },
      ] },
  ],
  groupableFields: ["agency", "site", "department", "payType"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const span = await rangeDays(config.dateRange, tenantId);
    const byId = Object.fromEntries(hoursAndPaySource.columns.map((c) => [c.id, c]));
    const columns = config.columns.map((id) => byId[id]).filter(Boolean).map((c) => ({ id: c.id, label: c.label, type: c.type }));
    if (!span) return { columns, rows: [], totalRows: 0 };

    const employees = await db.employee.findMany({
      where: { tenantId, ...buildWhereClause(config.filters, fieldMap) },
      select: {
        id: true,
        wmsId: true,
        employeeCode: true,
        payType: true,
        user: { select: { name: true } },
        site: { select: { name: true } },
        department: { select: { name: true } },
        agencyRef: { select: { code: true, description: true } },
        ruleSet: { select: { otRateMultiplier: true, dtRateMultiplier: true } },
        payRates: { select: { id: true, effectiveDate: true, rate1: true } },
      },
    });
    const empty = { columns, rows: [], totalRows: 0, period: { ...span, label: describeSpan(span) }, titleRows: true };
    if (employees.length === 0) return empty;

    // Timesheet status, for a backup run on locked timesheets only.
    const statusFilter = config.filters.find((f) => f.field === "status");
    const statuses = statusFilter ? (Array.isArray(statusFilter.value) ? statusFilter.value : [statusFilter.value]).map(String) : null;

    // Paid hours by person, day and kind, added up in the database.
    const hours = await db.$queryRaw<{ e: string; d: string; k: Kind; m: number }[]>`
      select t."employeeId" e, w."segmentDate"::date::text d,
        case when w."segmentType" = 'WORK' and w."payBucket" in ('OT', 'DT') then w."payBucket"::text
             when w."segmentType" = 'WORK' then 'REG'
             when w."segmentType" = 'HOLIDAY' then 'HOLIDAY'
             else 'LEAVE' end k,
        sum(w."durationMinutes")::int m
      from work_segments w join timesheets t on t.id = w."timesheetId"
      where w."isPaid" and w."durationMinutes" > 0
        and w."segmentType" in ('WORK', 'LEAVE', 'HOLIDAY')
        and w."segmentDate" between ${span.start}::date and ${span.end}::date
        and t."employeeId" = any(${employees.map((e) => e.id)})
        ${statuses ? Prisma.sql`and t.status::text = any(${statuses})` : Prisma.empty}
      group by 1, 2, 3`;

    const byEmployee = new Map<string, typeof hours>();
    for (const h of hours) byEmployee.set(h.e, [...(byEmployee.get(h.e) ?? []), h]);

    const rows = employees
      .filter((e) => byEmployee.has(e.id))
      .map((e) => {
        const salaried = e.payType === "SALARY";
        const multiplier: Record<Kind, number> = {
          REG: 1,
          OT: (e.ruleSet?.otRateMultiplier ?? 150) / 100,
          DT: (e.ruleSet?.dtRateMultiplier ?? 200) / 100,
          HOLIDAY: 1,
          LEAVE: 1,
        };
        const minutes: Record<Kind, number> = { REG: 0, OT: 0, DT: 0, HOLIDAY: 0, LEAVE: 0 };
        let pay = 0;
        let unrated = 0;
        for (const h of byEmployee.get(e.id)!) {
          minutes[h.k] += h.m;
          const row = rateInEffect(e.payRates, h.d);
          const rate = row ? Number(row.rate1) : NaN;
          if (!row || !(rate > 0) || (salaried && rate >= YEARLY_RATE)) {
            unrated += h.m;
            continue;
          }
          pay += (h.m / 60) * rate * multiplier[h.k];
        }

        const latest = rateInEffect(e.payRates, span.end);
        const latestRate = latest ? Number(latest.rate1) : null;
        const total = minutes.REG + minutes.OT + minutes.DT + minutes.HOLIDAY + minutes.LEAVE;
        return {
          employeeName: lastNameFirst(e.user?.name ?? e.employeeCode),
          employeeCode: e.wmsId ?? e.employeeCode,
          agency: e.agencyRef ? `${e.agencyRef.code} ${e.agencyRef.description}`.trim() : null,
          site: e.site.name,
          department: e.department.name,
          payType: salaried ? "Salary" : e.payType === "HOURLY" ? "Hourly" : null,
          salaryMinutes: salaried ? minutes.REG : 0,
          regMinutes: salaried ? 0 : minutes.REG,
          otMinutes: minutes.OT,
          dtMinutes: minutes.DT,
          holidayMinutes: minutes.HOLIDAY,
          ptoMinutes: minutes.LEAVE,
          totalMinutes: total,
          payCost: unrated > 0 ? null : cents(pay),
          payRate: latestRate === null || (salaried && latestRate >= YEARLY_RATE) ? null : latestRate,
          unratedMinutes: unrated,
        };
      });

    // By last name, unless the report says otherwise.
    rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    // Timesheet status was applied to the hours above.
    const filtered = filterRowsInMemory(rows, config.filters.filter((f) => f.field !== "status"), fieldMap);
    const sorted = sortRowsInMemory(filtered, config.sortBy, fieldMap);
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
    const label = await periodLabel(span, employees.filter((e) => byEmployee.has(e.id)).map((e) => e.id));
    return { columns, rows: limited, totalRows: sorted.length, period: { ...span, label }, titleRows: true };
  },
};
