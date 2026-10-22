import { db } from "@/lib/db";
import type { DataSourceDefinition, ReportResult } from "./index";
import { buildWhereClause, filterRowsInMemory, sortRowsInMemory, type FieldMap } from "../query-builder";
import { periodDayRange } from "@/lib/pay-period-days";
import { daysOf } from "../period";
import { rateInEffect } from "@/lib/pay-rates";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * Labor cost: for each employee, the hours in the report's dates priced at the
 * pay rate and at the charge rate, for labor cost review and checking agency
 * invoices.
 *
 * <p>Each day's hours are priced at the rates in effect that day (the pay rate
 * history's row effective on or before it), so a raise mid-period is costed
 * from its own day. Overtime is priced at 1.5 times the rate and double time
 * at 2, for pay and for charge alike. Charge covers worked hours only: paid
 * time off and meal premiums are a cost to Bergen, not billed hours. Hours
 * with no rate in effect are counted apart rather than priced at nothing.
 * Salaried people are listed with their hours only: their Rate 1 is a yearly
 * amount.
 */

const fieldMap: FieldMap = {
  employeeName: { prismaPath: "user.name", type: "string" },
  employeeCode: { prismaPath: "wmsId", type: "string" },
  siteId: { prismaPath: "siteId", type: "string" },
  departmentId: { prismaPath: "departmentId", type: "string" },
  agencyId: { prismaPath: "agencyId", type: "string" },
  payType: { prismaPath: "payType", type: "string" },
};

const MULTIPLIER: Record<string, number> = { REG: 1, OT: 1.5, DT: 2 };
const cents = (n: number) => Math.round(n * 100) / 100;

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

export const laborCostSource: DataSourceDefinition = {
  id: "LABOR_COST",
  label: "Labor cost",
  description: "Each employee's hours priced at their pay rate and their charge rate, day by day, for labor cost review and agency invoices.",
  icon: "Wallet",
  columns: [
    { id: "employeeName", label: "Employee", type: "string", defaultVisible: true },
    { id: "employeeCode", label: "Badge ID", type: "string", defaultVisible: true },
    { id: "agency", label: "Agency", type: "string", defaultVisible: true },
    { id: "site", label: "Site", type: "string", defaultVisible: false },
    { id: "department", label: "Department", type: "string", defaultVisible: false },
    { id: "payType", label: "Hourly or salary", type: "string", defaultVisible: false },
    { id: "regMinutes", label: "Regular", type: "number", defaultVisible: true },
    { id: "otMinutes", label: "Overtime", type: "number", defaultVisible: true },
    { id: "dtMinutes", label: "Double time", type: "number", defaultVisible: true },
    { id: "leaveMinutes", label: "Paid time off", type: "number", defaultVisible: false },
    { id: "premiumMinutes", label: "Meal premium", type: "number", defaultVisible: false },
    { id: "payRate", label: "Pay rate (latest)", type: "number", defaultVisible: true },
    { id: "chargeRate", label: "Charge rate (latest)", type: "number", defaultVisible: true },
    { id: "payCost", label: "Pay cost", type: "number", defaultVisible: true, total: true },
    { id: "chargeCost", label: "Charge cost", type: "number", defaultVisible: true, total: true },
    { id: "unratedMinutes", label: "Hours with no pay rate", type: "number", defaultVisible: false },
    { id: "unchargedMinutes", label: "Worked hours with no charge rate", type: "number", defaultVisible: false },
  ],
  filters: [
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
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
  ],
  groupableFields: ["agency", "site", "department", "payType"],
  fieldMap,

  async execute(config: ReportConfig, tenantId: string): Promise<ReportResult> {
    const span = await rangeDays(config.dateRange, tenantId);
    const visible = (() => {
      const byId = Object.fromEntries(laborCostSource.columns.map((c) => [c.id, c]));
      return config.columns.map((id) => byId[id]).filter(Boolean);
    })();
    const empty = { columns: visible.map((c) => ({ id: c.id, label: c.label, type: c.type })), rows: [], totalRows: 0 };
    if (!span) return empty;

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
        payRates: { select: { effectiveDate: true, rate1: true, chargeRate: true } },
      },
    });
    if (employees.length === 0) return empty;

    // Paid hours by person, day and kind: the engine's bucket for worked
    // time, LEAVE for paid time off and holidays, PREMIUM for meal premiums.
    const hours = await db.$queryRaw<{ e: string; d: string; k: string; m: number }[]>`
      select t."employeeId" e, w."segmentDate"::date::text d,
        case when w."segmentType" = 'WORK' then w."payBucket"::text
             when w."segmentType" = 'MEAL_PREMIUM' then 'PREMIUM'
             else 'LEAVE' end k,
        sum(w."durationMinutes")::int m
      from work_segments w join timesheets t on t.id = w."timesheetId"
      where w."isPaid" and w."durationMinutes" > 0
        and w."segmentType" in ('WORK', 'LEAVE', 'HOLIDAY', 'MEAL_PREMIUM')
        and w."segmentDate" between ${span.first}::date and ${span.last}::date
        and t."employeeId" = any(${employees.map((e) => e.id)})
      group by 1, 2, 3`;

    const byEmployee = new Map<string, typeof hours>();
    for (const h of hours) byEmployee.set(h.e, [...(byEmployee.get(h.e) ?? []), h]);

    const rows = employees
      .filter((e) => byEmployee.has(e.id))
      .map((e) => {
        const salaried = e.payType === "SALARY";
        let reg = 0, ot = 0, dt = 0, leave = 0, premium = 0, unrated = 0, uncharged = 0;
        let payCost = 0, chargeCost = 0;
        for (const h of byEmployee.get(e.id)!) {
          const kind = h.k === "OT" || h.k === "DT" || h.k === "LEAVE" || h.k === "PREMIUM" ? h.k : "REG";
          if (kind === "REG") reg += h.m;
          else if (kind === "OT") ot += h.m;
          else if (kind === "DT") dt += h.m;
          else if (kind === "LEAVE") leave += h.m;
          else premium += h.m;
          if (salaried) continue;

          const row = rateInEffect(e.payRates, h.d);
          const worked = kind === "REG" || kind === "OT" || kind === "DT";
          const multiplier = MULTIPLIER[kind] ?? 1;
          if (!row) {
            unrated += h.m;
            if (worked) uncharged += h.m;
            continue;
          }
          payCost += (h.m / 60) * Number(row.rate1) * multiplier;
          if (!worked) continue;
          if (row.chargeRate == null) uncharged += h.m;
          else chargeCost += (h.m / 60) * Number(row.chargeRate) * multiplier;
        }
        const latest = rateInEffect(e.payRates, span.last);
        return {
          employeeName: e.user?.name ?? e.employeeCode,
          employeeCode: e.wmsId ?? e.employeeCode,
          agency: e.agencyRef ? `${e.agencyRef.code} ${e.agencyRef.description}`.trim() : null,
          site: e.site.name,
          department: e.department.name,
          payType: salaried ? "Salary" : e.payType === "HOURLY" ? "Hourly" : null,
          regMinutes: reg,
          otMinutes: ot,
          dtMinutes: dt,
          leaveMinutes: leave,
          premiumMinutes: premium,
          payRate: salaried || !latest ? null : Number(latest.rate1),
          chargeRate: salaried || latest?.chargeRate == null ? null : Number(latest.chargeRate),
          payCost: salaried ? null : cents(payCost),
          chargeCost: salaried ? null : cents(chargeCost),
          unratedMinutes: unrated,
          unchargedMinutes: uncharged,
        };
      });

    // By agency, then name, unless the report says otherwise.
    rows.sort((a, b) => (a.agency ?? "").localeCompare(b.agency ?? "") || a.employeeName.localeCompare(b.employeeName));
    const filtered = filterRowsInMemory(rows, config.filters, fieldMap);
    const sorted = sortRowsInMemory(filtered, config.sortBy, fieldMap);
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
    return { columns: visible.map((c) => ({ id: c.id, label: c.label, type: c.type })), rows: limited, totalRows: limited.length };
  },
};
