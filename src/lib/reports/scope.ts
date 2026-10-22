import type { PayFrequency, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { periodDayRange } from "@/lib/pay-period-days";
import { snapToLocalTime } from "@/lib/utils/date";
import { buildWhereClause, type FieldMap } from "./query-builder";
import { daysOf, REPORT_ZONE, type DaySpan } from "./period";
import type { ExecuteContext } from "./data-sources";
import type { FilterDef, ReportConfig } from "@/lib/validators/report.schema";

/**
 * What the newer report types share: the days a report covers, and the
 * people its filters pick, always inside the company. Site is one of those
 * filters, and it is how a report is held to the sites its creator may see
 * (creator-sites.ts), so every report type built on this honours it.
 */

/** The report's days, first and last (yyyy-mm-dd): a pay period's own days, or the dates picked. */
export async function reportSpan(range: ReportConfig["dateRange"], tenantId: string, ctx?: ExecuteContext): Promise<DaySpan | null> {
  if (range.type === "payPeriod") {
    const p = await db.payPeriod.findFirst({
      where: { id: range.payPeriodId, tenantId },
      select: { startDate: true, endDate: true, ruleSet: { select: { payFrequency: true } }, tenant: { select: { payFrequency: true } } },
    });
    if (!p) return null;
    const r = periodDayRange(p, (p.ruleSet?.payFrequency ?? p.tenant.payFrequency) as PayFrequency);
    return { start: r.firstDay, end: r.lastDay };
  }
  return daysOf(range, ctx?.timezone ?? REPORT_ZONE, ctx?.now);
}

/** The moments a span runs between, in a time zone: its first midnight, and the one after its last day. */
export function spanMoments(span: DaySpan, timeZone: string = REPORT_ZONE): { from: Date; until: Date } {
  const next = new Date(Date.parse(`${span.end}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { from: snapToLocalTime("00:00", span.start, timeZone), until: snapToLocalTime("00:00", next, timeZone) };
}

/** The filters every newer report type offers about the person. */
export const PERSON_FIELDS: FieldMap = {
  employeeName: { prismaPath: "user.name", type: "string" },
  employeeCode: { prismaPath: "wmsId", type: "string" },
  departmentId: { prismaPath: "departmentId", type: "string" },
  siteId: { prismaPath: "siteId", type: "string" },
  isActive: { prismaPath: "isActive", type: "boolean" },
  supervisorId: { prismaPath: "supervisorId", type: "string" },
};

export const PERSON_FILTERS = [
  { id: "employeeName", label: "Employee name", type: "string" as const, operators: ["contains", "eq"] },
  { id: "employeeCode", label: "Badge ID", type: "string" as const, operators: ["contains", "eq"] },
  { id: "departmentId", label: "Department", type: "string" as const, operators: ["eq", "in"] },
  { id: "siteId", label: "Site", type: "string" as const, operators: ["eq", "in"] },
  {
    id: "isActive", label: "Status", type: "boolean" as const, operators: ["eq"],
    options: [{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }],
  },
  { id: "supervisorId", label: "Supervisor", type: "string" as const, operators: ["eq", "in"] },
];

export interface Person {
  id: string;
  name: string;
  badge: string;
  department: string;
  site: string;
  siteId: string;
  timeZone: string;
  isActive: boolean;
  terminatedAt: Date | null;
}

/**
 * The company's people the report's filters pick (name, badge, department,
 * site), current or not: a history includes people who have since left.
 */
export async function peopleFor(filters: FilterDef[], tenantId: string): Promise<Person[]> {
  const where = buildWhereClause(filters, PERSON_FIELDS) as Prisma.EmployeeWhereInput;
  const rows = await db.employee.findMany({
    where: { ...where, tenantId },
    select: {
      id: true, wmsId: true, employeeCode: true, isActive: true, terminatedAt: true, timeZone: true, siteId: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
      site: { select: { name: true, timezone: true } },
    },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map((e) => ({
    id: e.id,
    name: e.user?.name ?? e.employeeCode,
    badge: e.wmsId ?? e.employeeCode,
    department: e.department.name,
    site: e.site.name,
    siteId: e.siteId,
    timeZone: e.timeZone || e.site.timezone || REPORT_ZONE,
    isActive: e.isActive,
    terminatedAt: e.terminatedAt,
  }));
}

/** The person's columns on a row. */
export function personCells(p: Person) {
  return { employeeName: p.name, employeeCode: p.badge, department: p.department, site: p.site };
}

/** A moment as a person reads it where they are: "10/12/2026, 3:04 PM". */
export function localMoment(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit",
  }).format(at);
}

/** The calendar day a moment falls on in a zone, yyyy-mm-dd. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The columns a report asks for, from its type's list, in its order. */
export function visible(columns: { id: string; label: string; type: string; total?: boolean }[], ids: string[]) {
  const byId = new Map(columns.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ id: c.id, label: c.label, type: c.type, ...(c.total !== undefined ? { total: c.total } : {}) }));
}

/** Text filters on values a report works out itself (contains, is, is any of). */
export function textFilter(rows: Record<string, unknown>[], filters: FilterDef[], fields: string[]): Record<string, unknown>[] {
  const own = filters.filter((f) => fields.includes(f.field));
  if (own.length === 0) return rows;
  return rows.filter((row) =>
    own.every((f) => {
      const v = String(row[f.field] ?? "").toLowerCase();
      const want = Array.isArray(f.value) ? f.value.map((x) => String(x).toLowerCase()) : [String(f.value).toLowerCase()];
      if (f.operator === "contains") return v.includes(want[0]);
      if (f.operator === "neq" || f.operator === "notIn") return !want.includes(v);
      return want.includes(v);
    })
  );
}
