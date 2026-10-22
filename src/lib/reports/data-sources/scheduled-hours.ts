import { db } from "@/lib/db";
import type { DataSourceDefinition, ExecuteContext, ReportResult } from "./index";
import { filterRowsInMemory, sortRowsInMemory } from "../query-builder";
import { describeSpan, REPORT_ZONE, todayIn } from "../period";
import { localMoment, peopleFor, PERSON_FIELDS, PERSON_FILTERS, personCells, reportSpan, visible } from "../scope";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * Each person's scheduled hours against the hours they worked in the dates,
 * with their time off and last punch: NovaTime's Employee Activity Report.
 *
 * <p>A scheduled day's hours are its start to its end, less its meal; a
 * shift that ends after midnight runs into the next day. Only days up to
 * today count as scheduled, so a pay period still running is not measured
 * against days nobody could have worked yet. Worked hours are the paid work
 * on the timecard, by the day it is dated, as Daily hours counts them.
 */
const columns = [
  { id: "employeeName", label: "Employee", type: "string" as const, defaultVisible: true },
  { id: "employeeCode", label: "Badge ID", type: "string" as const, defaultVisible: true },
  { id: "department", label: "Department", type: "string" as const, defaultVisible: true },
  { id: "site", label: "Site", type: "string" as const, defaultVisible: false },
  { id: "scheduledDays", label: "Days scheduled", type: "number" as const, defaultVisible: false, total: true },
  { id: "scheduledMinutes", label: "Scheduled", type: "number" as const, defaultVisible: true },
  { id: "workedDays", label: "Days worked", type: "number" as const, defaultVisible: false, total: true },
  { id: "workedMinutes", label: "Worked", type: "number" as const, defaultVisible: true },
  { id: "differenceMinutes", label: "Worked minus scheduled", type: "number" as const, defaultVisible: true },
  { id: "timeOffMinutes", label: "Time off", type: "number" as const, defaultVisible: true },
  { id: "lastPunch", label: "Last punch", type: "string" as const, defaultVisible: false },
  { id: "status", label: "Status", type: "string" as const, defaultVisible: false },
  { id: "terminatedAt", label: "Termination date", type: "date" as const, defaultVisible: false },
];

export const scheduledHoursSource: DataSourceDefinition = {
  id: "SCHEDULED_HOURS",
  label: "Scheduled and worked hours",
  description: "Each employee's scheduled hours up to today against the hours they worked, with their time off and last punch.",
  icon: "CalendarCheck",
  columns,
  filters: [
    ...PERSON_FILTERS,
    { id: "differenceMinutes", label: "Worked minus scheduled, in minutes", type: "number", operators: ["gte", "lte", "between"] },
  ],
  groupableFields: ["department", "site", "status"],
  fieldMap: PERSON_FIELDS,

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const cols = visible(columns, config.columns);
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    const people = await peopleFor(config.filters, tenantId);
    if (!span || people.length === 0) return { columns: cols, rows: [], totalRows: 0 };
    const ids = people.map((p) => p.id);
    const first = new Date(`${span.start}T00:00:00Z`);
    const last = new Date(`${span.end}T00:00:00Z`);
    const today = todayIn(ctx?.timezone ?? REPORT_ZONE, ctx?.now);
    const lastScheduled = new Date(`${span.end < today ? span.end : today}T00:00:00Z`);

    const [scheduled, worked, punches] = await Promise.all([
      db.$queryRaw<{ employeeId: string; days: number; minutes: number }[]>`
        SELECT "employeeId",
          COUNT(*) FILTER (WHERE "isWorkday")::int AS days,
          COALESCE(SUM(CASE WHEN "isWorkday" AND "startTime" ~ '^\\d{1,2}:\\d{2}$' AND "endTime" ~ '^\\d{1,2}:\\d{2}$' THEN
            GREATEST(0,
              ((split_part("endTime", ':', 1)::int * 60 + split_part("endTime", ':', 2)::int)
               - (split_part("startTime", ':', 1)::int * 60 + split_part("startTime", ':', 2)::int) + 1440) % 1440
              - COALESCE("mealMinutes", 0))
          ELSE 0 END), 0)::int AS minutes
        FROM schedule_days
        WHERE "employeeId" = ANY(${ids}) AND "workDate" BETWEEN ${first}::date AND ${lastScheduled}::date
        GROUP BY 1`,
      db.$queryRaw<{ employeeId: string; worked: number; days: number; timeOff: number }[]>`
        SELECT t."employeeId",
          COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."segmentType" = 'WORK' AND s."isPaid"), 0)::int AS worked,
          COUNT(DISTINCT s."segmentDate") FILTER (WHERE s."segmentType" = 'WORK' AND s."durationMinutes" > 0)::int AS days,
          COALESCE(SUM(s."durationMinutes") FILTER (WHERE s."segmentType" IN ('LEAVE', 'HOLIDAY') AND s."isPaid"), 0)::int AS "timeOff"
        FROM work_segments s JOIN timesheets t ON t.id = s."timesheetId"
        WHERE t."employeeId" = ANY(${ids}) AND s."segmentDate" BETWEEN ${first}::date AND ${last}::date
        GROUP BY 1`,
      db.punch.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: ids }, isApproved: true, correctedById: null },
        _max: { punchTime: true },
      }),
    ]);
    const sch = new Map(scheduled.map((r) => [r.employeeId, r]));
    const wk = new Map(worked.map((r) => [r.employeeId, r]));
    const lastPunch = new Map(punches.map((p) => [p.employeeId, p._max.punchTime]));

    let rows: Record<string, unknown>[] = people
      .filter((p) => sch.has(p.id) || wk.has(p.id))
      .map((p) => {
        const s = sch.get(p.id);
        const w = wk.get(p.id);
        const lp = lastPunch.get(p.id);
        return {
          ...personCells(p),
          scheduledDays: s?.days ?? 0,
          scheduledMinutes: s?.minutes ?? 0,
          workedDays: w?.days ?? 0,
          workedMinutes: w?.worked ?? 0,
          differenceMinutes: (w?.worked ?? 0) - (s?.minutes ?? 0),
          timeOffMinutes: w?.timeOff ?? 0,
          lastPunch: lp ? localMoment(lp, p.timeZone) : "Never",
          status: p.isActive ? "Active" : "Inactive",
          terminatedAt: p.terminatedAt ? p.terminatedAt.toISOString().slice(0, 10) : null,
        };
      });
    rows = filterRowsInMemory(rows, config.filters, PERSON_FIELDS);
    const sorted = sortRowsInMemory(rows, config.sortBy, {});
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
    return { columns: cols, rows: limited, totalRows: sorted.length, period: { ...span, label: describeSpan(span) } };
  },
};
