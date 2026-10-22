import { db } from "@/lib/db";
import { rateInEffect } from "@/lib/pay-rates";
import type { DataSourceDefinition, ExecuteContext, ReportResult } from "./index";
import { dailyHoursSource } from "./daily-hours";
import { filterRowsInMemory, sortRowsInMemory } from "../query-builder";
import { describeSpan } from "../period";
import { tenantWeekStart } from "../moving-period";
import { peopleFor, PERSON_FIELDS, PERSON_FILTERS, personCells, reportSpan, visible } from "../scope";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * Reports that are a calculation over the timecard rather than a list from
 * it: hours to date with their weekly and daily averages, overtime by week
 * with its OBBB amount, and attendance by month.
 *
 * <p>Worked hours are paid work by the day it is dated, as Daily hours counts
 * them, and weeks start on the company's day (see tenantWeekStart).
 */

const person = [
  { id: "employeeName", label: "Employee", type: "string" as const, defaultVisible: true },
  { id: "employeeCode", label: "Badge ID", type: "string" as const, defaultVisible: true },
  { id: "department", label: "Department", type: "string" as const, defaultVisible: false },
  { id: "site", label: "Site", type: "string" as const, defaultVisible: false },
];

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function finish(rows: Record<string, unknown>[], config: ReportConfig, columns: { id: string; label: string; type: string; total?: boolean }[], span: { start: string; end: string }): ReportResult {
  const filtered = filterRowsInMemory(rows, config.filters, PERSON_FIELDS);
  const sorted = sortRowsInMemory(filtered, config.sortBy, {});
  const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
  return { columns: visible(columns, config.columns), rows: limited, totalRows: sorted.length, period: { ...span, label: describeSpan(span) } };
}

// ─── Hours year to date ─────────────────────────────────────────────────────

const ytdColumns = [
  ...person,
  { id: "regMinutes", label: "Regular", type: "number" as const, defaultVisible: true },
  { id: "otMinutes", label: "Overtime", type: "number" as const, defaultVisible: false },
  { id: "dtMinutes", label: "Double time", type: "number" as const, defaultVisible: false },
  { id: "totalMinutes", label: "Total", type: "number" as const, defaultVisible: true },
  { id: "ytdMinutes", label: "Year to date", type: "number" as const, defaultVisible: true },
  { id: "weeksWorked", label: "Weeks with hours", type: "number" as const, defaultVisible: true, total: true },
  { id: "weeklyAverageMinutes", label: "Average a week", type: "number" as const, defaultVisible: true, total: false },
  { id: "daysWorked", label: "Days worked this year", type: "number" as const, defaultVisible: false, total: true },
  { id: "dailyAverageMinutes", label: "Average a day", type: "number" as const, defaultVisible: true, total: false },
];

export const hoursToDateSource: DataSourceDefinition = {
  id: "HOURS_TO_DATE",
  label: "Hours year to date",
  description: "Each employee's hours in the dates beside their hours this year, with the average a week and a day they worked.",
  icon: "TrendingUp",
  columns: ytdColumns,
  filters: PERSON_FILTERS,
  groupableFields: ["department", "site"],
  fieldMap: PERSON_FIELDS,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    const people = await peopleFor(config.filters, tenantId);
    if (!span || people.length === 0) return { columns: visible(ytdColumns, config.columns), rows: [], totalRows: 0 };
    const ws = await tenantWeekStart(tenantId);
    const yearStart = `${span.end.slice(0, 4)}-01-01`;
    const sums = await db.$queryRaw<{ employeeId: string; reg: number; ot: number; dt: number; ytd: number; weeks: number; days: number }[]>`
      SELECT t."employeeId",
        COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."segmentDate" >= ${utc(span.start)}::date AND s."payBucket" = 'REG'), 0)::int AS reg,
        COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."segmentDate" >= ${utc(span.start)}::date AND s."payBucket" = 'OT'), 0)::int AS ot,
        COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."segmentDate" >= ${utc(span.start)}::date AND s."payBucket" = 'DT'), 0)::int AS dt,
        COALESCE(SUM(s."durationMinutes"), 0)::int AS ytd,
        COUNT(DISTINCT s."segmentDate" - ((EXTRACT(DOW FROM s."segmentDate")::int - ${ws} + 7) % 7))::int AS weeks,
        COUNT(DISTINCT s."segmentDate")::int AS days
      FROM work_segments s JOIN timesheets t ON t.id = s."timesheetId"
      WHERE t."employeeId" = ANY(${people.map((p) => p.id)})
        AND s."segmentType" = 'WORK' AND s."isPaid" AND s."durationMinutes" > 0
        AND s."segmentDate" BETWEEN ${utc(yearStart)}::date AND ${utc(span.end)}::date
      GROUP BY 1`;
    const byId = new Map(sums.map((s) => [s.employeeId, s]));
    const rows = people
      .filter((p) => byId.has(p.id))
      .map((p) => {
        const s = byId.get(p.id)!;
        return {
          ...personCells(p),
          regMinutes: s.reg,
          otMinutes: s.ot,
          dtMinutes: s.dt,
          totalMinutes: s.reg + s.ot + s.dt,
          ytdMinutes: s.ytd,
          weeksWorked: s.weeks,
          weeklyAverageMinutes: s.weeks ? s.ytd / s.weeks : 0,
          daysWorked: s.days,
          dailyAverageMinutes: s.days ? s.ytd / s.days : 0,
        };
      });
    return finish(rows, config, ytdColumns, span);
  },
};

// ─── Weekly overtime and the OBBB amount ────────────────────────────────────

const weeklyColumns = [
  ...person,
  { id: "weekStart", label: "Week start", type: "date" as const, defaultVisible: true },
  { id: "weekEnd", label: "Week end", type: "date" as const, defaultVisible: true },
  { id: "regMinutes", label: "Regular", type: "number" as const, defaultVisible: false },
  { id: "otMinutes", label: "Overtime", type: "number" as const, defaultVisible: true },
  { id: "dtMinutes", label: "Double time", type: "number" as const, defaultVisible: false },
  { id: "payRate", label: "Pay rate", type: "number" as const, defaultVisible: true },
  { id: "obbbAmount", label: "OBBB amount", type: "number" as const, defaultVisible: true, total: true },
];

export const weeklyOvertimeSource: DataSourceDefinition = {
  id: "WEEKLY_OVERTIME",
  label: "Weekly overtime",
  description: "Each employee's overtime by week, with their pay rate and the OBBB amount: half the rate for each overtime hour.",
  icon: "Clock4",
  columns: weeklyColumns,
  filters: PERSON_FILTERS,
  groupableFields: ["employeeName", "department", "site", "weekStart"],
  fieldMap: PERSON_FIELDS,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    const people = await peopleFor(config.filters, tenantId);
    if (!span || people.length === 0) return { columns: visible(weeklyColumns, config.columns), rows: [], totalRows: 0 };
    const ws = await tenantWeekStart(tenantId);
    const ids = people.map((p) => p.id);
    const [sums, rates] = await Promise.all([
      db.$queryRaw<{ employeeId: string; week: Date; reg: number; ot: number; dt: number }[]>`
        SELECT t."employeeId",
          s."segmentDate" - ((EXTRACT(DOW FROM s."segmentDate")::int - ${ws} + 7) % 7) AS week,
          COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."payBucket" = 'REG'), 0)::int AS reg,
          COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."payBucket" = 'OT'), 0)::int AS ot,
          COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."payBucket" = 'DT'), 0)::int AS dt
        FROM work_segments s JOIN timesheets t ON t.id = s."timesheetId"
        WHERE t."employeeId" = ANY(${ids}) AND s."segmentType" = 'WORK' AND s."isPaid"
          AND s."segmentDate" BETWEEN ${utc(span.start)}::date AND ${utc(span.end)}::date
        GROUP BY 1, 2
        HAVING SUM(s."durationMinutes") FILTER (WHERE s."payBucket" IN ('OT', 'DT')) > 0`,
      db.employeePayRate.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, effectiveDate: true, rate1: true } }),
    ]);
    const ratesOf = new Map<string, typeof rates>();
    for (const r of rates) ratesOf.set(r.employeeId, [...(ratesOf.get(r.employeeId) ?? []), r]);
    const byId = new Map(people.map((p) => [p.id, p]));
    const rows = sums.map((s) => {
      const start = day(s.week);
      const end = day(new Date(s.week.getTime() + 6 * DAY));
      // The rate in effect at the week's end, as the week's overtime is paid on it.
      const row = rateInEffect(ratesOf.get(s.employeeId) ?? [], end);
      const rate = row?.rate1 != null ? Number(row.rate1) : null;
      return {
        ...personCells(byId.get(s.employeeId)!),
        weekStart: start,
        weekEnd: end,
        regMinutes: s.reg,
        otMinutes: s.ot,
        dtMinutes: s.dt,
        payRate: rate,
        // Overtime hours at half the rate: the premium part of time and a half.
        obbbAmount: rate != null ? Math.round((s.ot / 60) * rate * 0.5 * 100) / 100 : null,
      };
    });
    rows.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || a.weekStart.localeCompare(b.weekStart));
    return finish(rows, config, weeklyColumns, span);
  },
};

// ─── Attendance by month ────────────────────────────────────────────────────

const attendanceColumns = [
  ...person,
  { id: "month", label: "Month", type: "string" as const, defaultVisible: true, groupOrder: "monthKey", across: true },
  { id: "daysWorked", label: "Days worked", type: "number" as const, defaultVisible: true, total: true },
  { id: "lateDays", label: "Days late", type: "number" as const, defaultVisible: true, total: true },
  { id: "lateBy", label: "Minutes late", type: "number" as const, defaultVisible: false, total: true },
  { id: "absences", label: "Absences", type: "number" as const, defaultVisible: true, total: true },
  { id: "excusedAbsences", label: "Absences with a reason", type: "number" as const, defaultVisible: true, total: true },
  { id: "unexcusedAbsences", label: "Absences without a reason", type: "number" as const, defaultVisible: true, total: true },
  { id: "missedPunches", label: "Missed punches", type: "number" as const, defaultVisible: false, total: true },
  { id: "timeOffDays", label: "Days off", type: "number" as const, defaultVisible: false, total: true },
  { id: "timeOffMinutes", label: "Paid time off", type: "number" as const, defaultVisible: true },
  { id: "unpaidMinutes", label: "Unpaid time off", type: "number" as const, defaultVisible: true },
];

export const attendanceSummarySource: DataSourceDefinition = {
  id: "ATTENDANCE_SUMMARY",
  label: "Attendance summary",
  description: "Each employee's month: days worked, days late, absences with and without a reason, missed punches and time off taken.",
  icon: "CalendarRange",
  columns: attendanceColumns,
  filters: PERSON_FILTERS,
  groupableFields: ["employeeName", "department", "site", "month"],
  fieldMap: PERSON_FIELDS,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    if (!span) return { columns: visible(attendanceColumns, config.columns), rows: [], totalRows: 0 };
    // The days as Daily hours reads them, day type and all, then added up by month.
    const daily = await dailyHoursSource.execute(
      {
        ...config,
        columns: dailyHoursSource.columns.map((c) => c.id),
        filters: config.filters,
        groupBy: [],
        sortBy: [],
        dateRange: { type: "custom", startDate: span.start, endDate: span.end },
        limit: 200_000,
      },
      tenantId,
      ctx
    );
    const lines = new Map<string, Record<string, unknown>>();
    for (const r of daily.rows) {
      const date = String(r.date);
      const key = `${r.employeeCode}|${r.employeeName}|${date.slice(0, 7)}`;
      let line = lines.get(key);
      if (!line) {
        line = {
          employeeName: r.employeeName, employeeCode: r.employeeCode, department: r.department, site: r.site,
          month: utc(date).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
          monthKey: date.slice(0, 7),
          daysWorked: 0, lateDays: 0, lateBy: 0, absences: 0, excusedAbsences: 0, unexcusedAbsences: 0,
          missedPunches: 0, timeOffDays: 0, timeOffMinutes: 0, unpaidMinutes: 0,
        };
        lines.set(key, line);
      }
      const add = (k: string, n: number) => (line![k] = (line![k] as number) + n);
      const type = r.dayType;
      if (type === "Worked" || type === "Late" || (type === "Missed punch" && (r.totalMinutes as number) > 0)) add("daysWorked", 1);
      if (type === "Late") add("lateDays", 1);
      add("lateBy", (r.lateBy as number) ?? 0);
      if (type === "Missed punch") add("missedPunches", 1);
      if (type === "Absent") {
        add("absences", 1);
        add(r.reasonCode ? "excusedAbsences" : "unexcusedAbsences", 1);
      }
      if (type === "Time off") add("timeOffDays", 1);
      add("timeOffMinutes", (r.paidLeaveMinutes as number) ?? 0);
      add("unpaidMinutes", (r.unpaidLeaveMinutes as number) ?? 0);
    }
    const rows = [...lines.values()].sort(
      (a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || String(a.monthKey).localeCompare(String(b.monthKey))
    );
    const result = finish(rows, config, attendanceColumns, span);
    return daily.truncated ? { ...result, truncated: true } : result;
  },
};
