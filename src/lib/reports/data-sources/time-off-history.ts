import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DataSourceDefinition, ExecuteContext, ReportResult } from "./index";
import { sortRowsInMemory } from "../query-builder";
import { describeSpan, REPORT_ZONE } from "../period";
import {
  localDay, peopleFor, PERSON_FIELDS, PERSON_FILTERS, personCells, reportSpan, spanMoments, textFilter, visible,
} from "../scope";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * Time off history: every entry in the time off ledger (earned, used,
 * adjusted, carried over) with the balance after it, NovaTime's History
 * Report.ACC; and the same entries summed for each person and type of time
 * off, with the balance at the start and the end, NovaTime's History Summary
 * and Summary Report.ACC.
 *
 * <p>The ledger is the record of every change to a balance, written once and
 * never changed, so a balance on a day is the balance after the last entry
 * before it. Its recorded changes do not always explain its balances: on
 * Oct 22, 2026, 3,724 of 26,045 entries (793 people) moved the balance by
 * other than their own amount, mostly by a minute (earned time is recorded
 * in whole minutes while the balance keeps the fraction), some by much more
 * (a carry over recorded as 0 that moved a balance by 21 hours). The
 * balances agree with Time off balances, so the summary takes them as they
 * are and counts every change not recorded as earned or used as adjusted:
 * a line always reads start, plus earned, less used, plus adjusted, is the end.
 */

/** What each kind of entry is called, in HR's words. */
export const ENTRY_LABEL: Record<string, string> = {
  ACCRUAL: "Earned",
  EARNED_ADJUSTMENT: "Earned adjustment",
  USAGE: "Used",
  TIMECARD_DEDUCTION: "Used on the timecard",
  ADJUSTMENT: "Adjusted",
  CARRY_OVER: "Carried over",
  FORFEITURE: "Forfeited",
  BALANCE_RESET: "Balance reset",
  EOD_SNAPSHOT: "Balance check",
  POLICY_CHANGE: "Policy change",
};
const EARNED = ["ACCRUAL", "EARNED_ADJUSTMENT"];
const USED = ["USAGE", "TIMECARD_DEDUCTION"];

const typeFilters = [
  { id: "leaveTypeId", label: "Time off type", type: "string" as const, operators: ["eq", "in"] },
];

// ─── History: every entry ───────────────────────────────────────────────────

const historyColumns = [
  { id: "employeeName", label: "Employee", type: "string" as const, defaultVisible: true },
  { id: "employeeCode", label: "Badge ID", type: "string" as const, defaultVisible: true },
  { id: "department", label: "Department", type: "string" as const, defaultVisible: false },
  { id: "site", label: "Site", type: "string" as const, defaultVisible: false },
  { id: "leaveType", label: "Time off type", type: "string" as const, defaultVisible: true },
  { id: "postedOn", label: "Posted on", type: "date" as const, defaultVisible: true },
  { id: "entry", label: "Entry", type: "string" as const, defaultVisible: true },
  { id: "earnedMinutes", label: "Earned", type: "number" as const, defaultVisible: true },
  { id: "usedMinutes", label: "Used", type: "number" as const, defaultVisible: true },
  { id: "adjustedMinutes", label: "Adjusted", type: "number" as const, defaultVisible: true },
  { id: "balanceAfterMinutes", label: "Balance after", type: "number" as const, defaultVisible: true, total: false },
  { id: "payPeriodEnd", label: "Pay period ending", type: "date" as const, defaultVisible: false },
  { id: "note", label: "Note", type: "string" as const, defaultVisible: true },
];

export const timeOffHistorySource: DataSourceDefinition = {
  id: "TIME_OFF_HISTORY",
  label: "Time off history",
  description: "Every change to a time off balance in the dates: earned, used, adjusted or carried over, with the balance after it.",
  icon: "History",
  columns: historyColumns,
  filters: [
    ...PERSON_FILTERS,
    ...typeFilters,
    {
      id: "entry", label: "Entry", type: "string", operators: ["eq", "in"],
      options: Object.entries(ENTRY_LABEL).filter(([k]) => k !== "EOD_SNAPSHOT").map(([, label]) => ({ value: label, label })),
    },
  ],
  groupableFields: ["employeeName", "leaveType", "entry", "department", "site"],
  fieldMap: PERSON_FIELDS,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const cols = visible(historyColumns, config.columns);
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    const people = await peopleFor(config.filters, tenantId);
    if (!span || people.length === 0) return { columns: cols, rows: [], totalRows: 0 };
    const byId = new Map(people.map((p) => [p.id, p]));
    const { from, until } = spanMoments(span);
    const types = leaveTypesOf(config);

    const entries = await db.leaveAccrualLedger.findMany({
      where: {
        employeeId: { in: [...byId.keys()] },
        createdAt: { gte: from, lt: until },
        ...(types ? { leaveTypeId: { in: types } } : {}),
      },
      select: {
        employeeId: true, action: true, deltaMinutes: true, balanceAfter: true, payPeriodEnd: true, note: true, createdAt: true,
        leaveType: { select: { name: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    let rows: Record<string, unknown>[] = entries.map((e) => {
      const p = byId.get(e.employeeId)!;
      return {
        ...personCells(p),
        leaveType: e.leaveType.name,
        postedOn: localDay(e.createdAt, REPORT_ZONE),
        entry: ENTRY_LABEL[e.action] ?? e.action,
        earnedMinutes: EARNED.includes(e.action) ? e.deltaMinutes : 0,
        usedMinutes: USED.includes(e.action) ? -e.deltaMinutes : 0,
        adjustedMinutes: EARNED.includes(e.action) || USED.includes(e.action) ? 0 : e.deltaMinutes,
        balanceAfterMinutes: e.balanceAfter,
        payPeriodEnd: e.payPeriodEnd ? e.payPeriodEnd.toISOString().slice(0, 10) : null,
        note: e.note,
      };
    });
    rows = textFilter(rows, config.filters, ["entry"]);
    // Each person's entries together, oldest first, so the balance reads down.
    rows.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || String(a.leaveType).localeCompare(String(b.leaveType)));
    const sorted = sortRowsInMemory(rows, config.sortBy, {});
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
    return { columns: cols, rows: limited, totalRows: sorted.length, period: { ...span, label: describeSpan(span) } };
  },
};

// ─── Summary: each person and type ──────────────────────────────────────────

const summaryColumns = [
  { id: "employeeName", label: "Employee", type: "string" as const, defaultVisible: true },
  { id: "employeeCode", label: "Badge ID", type: "string" as const, defaultVisible: true },
  { id: "department", label: "Department", type: "string" as const, defaultVisible: false },
  { id: "site", label: "Site", type: "string" as const, defaultVisible: false },
  { id: "leaveType", label: "Time off type", type: "string" as const, defaultVisible: true },
  { id: "startBalanceMinutes", label: "Balance at start", type: "number" as const, defaultVisible: true, total: false },
  { id: "earnedMinutes", label: "Earned", type: "number" as const, defaultVisible: true },
  { id: "usedMinutes", label: "Used", type: "number" as const, defaultVisible: true },
  { id: "adjustedMinutes", label: "Adjusted", type: "number" as const, defaultVisible: true, exportLabel: "Adjusted (every other change)" },
  { id: "endBalanceMinutes", label: "Balance at end", type: "number" as const, defaultVisible: true, total: false },
  { id: "usedThisYearMinutes", label: "Used this year", type: "number" as const, defaultVisible: true },
  // By quarter of the year the dates end in, inside the dates: NovaTime's Annual Accrued vs. Used.
  ...[1, 2, 3, 4].flatMap((q) => [
    { id: `earnedQ${q}Minutes`, label: `Earned Q${q}`, type: "number" as const, defaultVisible: false },
    { id: `usedQ${q}Minutes`, label: `Used Q${q}`, type: "number" as const, defaultVisible: false },
  ]),
  { id: "earnedThisYearMinutes", label: "Earned this year", type: "number" as const, defaultVisible: false },
  { id: "forecastMinutes", label: "Forecast at year end", type: "number" as const, defaultVisible: false, total: false },
];

export const timeOffSummarySource: DataSourceDefinition = {
  id: "TIME_OFF_SUMMARY",
  label: "Time off summary",
  description: "For each employee and type of time off: the balance at the start of the dates, what was earned, used and adjusted, the balance at the end, and what was used this year.",
  icon: "Sigma",
  columns: summaryColumns,
  filters: [...PERSON_FILTERS, ...typeFilters],
  groupableFields: ["employeeName", "leaveType", "department", "site"],
  fieldMap: PERSON_FIELDS,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const cols = visible(summaryColumns, config.columns);
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    const people = await peopleFor(config.filters, tenantId);
    if (!span || people.length === 0) return { columns: cols, rows: [], totalRows: 0 };
    const byId = new Map(people.map((p) => [p.id, p]));
    const { from, until } = spanMoments(span);
    const yearFrom = spanMoments({ start: `${span.end.slice(0, 4)}-01-01`, end: span.end }).from;
    const types = leaveTypesOf(config);

    // Added up in the database: one line per person and type, from every
    // entry up to the end of the dates.
    const sums = await db.$queryRaw<{
      employeeId: string; leaveType: string; startBalance: number | null; endBalance: number;
      earned: number; used: number; adjusted: number; usedYear: number; earnedYear: number; inDates: number;
      [quarter: string]: unknown;
    }[]>`
      SELECT l."employeeId", t.name AS "leaveType",
        (array_agg(l."balanceAfter" ORDER BY l."createdAt" DESC, l.id DESC) FILTER (WHERE l."createdAt" < ${from}))[1] AS "startBalance",
        (array_agg(l."balanceAfter" ORDER BY l."createdAt" DESC, l.id DESC))[1] AS "endBalance",
        COALESCE(SUM(l."deltaMinutes") FILTER (WHERE l."createdAt" >= ${from} AND l.action::text = ANY(${EARNED})), 0)::int AS earned,
        COALESCE(-SUM(l."deltaMinutes") FILTER (WHERE l."createdAt" >= ${from} AND l.action::text = ANY(${USED})), 0)::int AS used,
        COALESCE(SUM(l."deltaMinutes") FILTER (WHERE l."createdAt" >= ${from} AND NOT (l.action::text = ANY(${[...EARNED, ...USED]}))), 0)::int AS adjusted,
        COALESCE(-SUM(l."deltaMinutes") FILTER (WHERE l."createdAt" >= ${yearFrom} AND l.action::text = ANY(${USED})), 0)::int AS "usedYear",
        COALESCE(SUM(l."deltaMinutes") FILTER (WHERE l."createdAt" >= ${yearFrom} AND l.action::text = ANY(${EARNED})), 0)::int AS "earnedYear",
        ${Prisma.join(
          [1, 2, 3, 4].flatMap((q) => [
            Prisma.sql`COALESCE(SUM(l."deltaMinutes") FILTER (WHERE l."createdAt" >= ${from} AND l."createdAt" >= ${yearFrom} AND EXTRACT(QUARTER FROM l."createdAt" AT TIME ZONE ${REPORT_ZONE}) = ${q} AND l.action::text = ANY(${EARNED})), 0)::int AS ${Prisma.raw(`"earnedQ${q}"`)}`,
            Prisma.sql`COALESCE(-SUM(l."deltaMinutes") FILTER (WHERE l."createdAt" >= ${from} AND l."createdAt" >= ${yearFrom} AND EXTRACT(QUARTER FROM l."createdAt" AT TIME ZONE ${REPORT_ZONE}) = ${q} AND l.action::text = ANY(${USED})), 0)::int AS ${Prisma.raw(`"usedQ${q}"`)}`,
          ])
        )},
        COUNT(*) FILTER (WHERE l."createdAt" >= ${from})::int AS "inDates"
      FROM leave_accrual_ledger l
      JOIN leave_types t ON t.id = l."leaveTypeId"
      WHERE l."employeeId" = ANY(${[...byId.keys()]})
        AND l."createdAt" < ${until}
        ${types ? Prisma.sql`AND l."leaveTypeId" = ANY(${types})` : Prisma.empty}
      GROUP BY 1, 2`;

    // The year so far, for the forecast: what was earned a day, for the days left.
    const yearOf = Number(span.end.slice(0, 4));
    const dayOfYear = (Date.parse(`${span.end}T12:00:00Z`) - Date.UTC(yearOf, 0, 1, 12)) / 86_400_000 + 1;
    const daysInYear = (Date.UTC(yearOf + 1, 0, 1) - Date.UTC(yearOf, 0, 1)) / 86_400_000;
    const rows: Record<string, unknown>[] = sums.map((s) => {
      const start = s.startBalance ?? 0;
      return {
        ...personCells(byId.get(s.employeeId)!),
        leaveType: s.leaveType,
        startBalanceMinutes: start,
        earnedMinutes: s.earned,
        usedMinutes: s.used,
        // Whatever else moved the balance, so the line adds up to the balance.
        adjustedMinutes: s.endBalance - start - s.earned + s.used,
        endBalanceMinutes: s.endBalance,
        usedThisYearMinutes: s.usedYear,
        ...Object.fromEntries([1, 2, 3, 4].flatMap((q) => [[`earnedQ${q}Minutes`, s[`earnedQ${q}`]], [`usedQ${q}Minutes`, s[`usedQ${q}`]]])),
        earnedThisYearMinutes: s.earnedYear,
        // The balance now, plus what this year's pace earns in the days left.
        forecastMinutes: Math.round(s.endBalance + (s.earnedYear / dayOfYear) * (daysInYear - dayOfYear)),
      };
    });
    rows.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || String(a.leaveType).localeCompare(String(b.leaveType)));
    const sorted = sortRowsInMemory(rows, config.sortBy, {});
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
    return { columns: cols, rows: limited, totalRows: sorted.length, period: { ...span, label: describeSpan(span) } };
  },
};

/** The time off types a report is limited to, or null for all. */
function leaveTypesOf(config: ReportConfig): string[] | null {
  const f = config.filters.find((x) => x.field === "leaveTypeId");
  if (!f) return null;
  return (Array.isArray(f.value) ? f.value : [f.value]).map(String);
}
