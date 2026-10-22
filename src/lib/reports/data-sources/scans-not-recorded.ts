import { db } from "@/lib/db";
import type { DataSourceDefinition, ExecuteContext, ReportResult } from "./index";
import { sortRowsInMemory } from "../query-builder";
import { describeSpan, REPORT_ZONE } from "../period";
import { localDay, reportSpan, spanMoments, textFilter, visible } from "../scope";
import type { ReportConfig } from "@/lib/validators/report.schema";

/**
 * Scans that did not become a punch, and why: a badge nobody has, a scan the
 * clock turned down (scanned again too soon), and people the gate turned
 * away for having no schedule that day. NovaTime's Unclaimed Punch and
 * Unsuccessful Punch reports.
 *
 * <p>A badge nobody has belongs to no company, so it is counted where it was
 * read: only at a reader of one of the company's own buildings (matched by
 * warehouse number, as the scan reports match them). One read anywhere else
 * is left out rather than shown to the wrong company.
 */

const PROBLEM = {
  unknown: "Badge not found",
  rejected: "Not recorded",
  refused: "Turned away at the gate",
} as const;

const columns = [
  { id: "date", label: "Date", type: "date" as const, defaultVisible: true },
  { id: "time", label: "Time", type: "string" as const, defaultVisible: true },
  { id: "problem", label: "Problem", type: "string" as const, defaultVisible: true },
  { id: "reason", label: "Reason", type: "string" as const, defaultVisible: true },
  { id: "employeeName", label: "Employee", type: "string" as const, defaultVisible: true },
  { id: "employeeCode", label: "Badge ID", type: "string" as const, defaultVisible: true },
  { id: "badge", label: "Badge scanned", type: "string" as const, defaultVisible: false },
  { id: "department", label: "Department", type: "string" as const, defaultVisible: false },
  { id: "site", label: "Site", type: "string" as const, defaultVisible: true },
  { id: "reader", label: "Reader", type: "string" as const, defaultVisible: true },
  { id: "kind", label: "Clock or gate", type: "string" as const, defaultVisible: false },
  { id: "attempts", label: "Attempts", type: "number" as const, defaultVisible: true, total: true },
];

export const scansNotRecordedSource: DataSourceDefinition = {
  id: "SCANS_NOT_RECORDED",
  label: "Scans not recorded",
  description: "Scans that did not become a punch, and why: a badge nobody has, a scan the clock turned down, or someone the gate turned away.",
  icon: "ScanLine",
  columns,
  filters: [
    {
      id: "problem", label: "Problem", type: "string", operators: ["eq", "in"],
      options: Object.values(PROBLEM).map((p) => ({ value: p, label: p })),
    },
    { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
    { id: "employeeCode", label: "Badge ID", type: "string", operators: ["contains", "eq"] },
    { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
    { id: "siteId", label: "Site", type: "string", operators: ["eq", "in"] },
  ],
  groupableFields: ["problem", "site", "employeeCode", "employeeName", "reader"],
  fieldMap: {},

  async execute(config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
    const cols = visible(columns, config.columns);
    const span = await reportSpan(config.dateRange, tenantId, ctx);
    if (!span) return { columns: cols, rows: [], totalRows: 0 };
    // A day either side, then each scan is kept by its own building's day.
    const { from, until } = spanMoments(span);
    const wideFrom = new Date(from.getTime() - 86_400_000);
    const wideUntil = new Date(until.getTime() + 86_400_000);

    const [scans, refusals] = await Promise.all([
      db.$queryRaw<{
        scanTime: Date; badgeCode: string; stream: string; outcome: string; rejectionReason: string | null; deviceName: string | null;
        employeeId: string | null; siteId: string | null; siteName: string | null; tz: string | null;
      }[]>`
        SELECT se."scanTime", se."badgeCode", se.stream::text AS stream, se.outcome::text AS outcome, se."rejectionReason",
               se."deviceName", e.id AS "employeeId",
               COALESCE(st.id, es.id) AS "siteId", COALESCE(st.name, es.name) AS "siteName", COALESCE(st.timezone, es.timezone) AS tz
        FROM scan_events se
        LEFT JOIN employees e ON e.id = se."employeeId" AND e."tenantId" = ${tenantId}
        LEFT JOIN sites es ON es.id = e."siteId"
        LEFT JOIN sites st ON st."tenantId" = ${tenantId}
                          AND st."wmsWarehouseId" = CASE WHEN se.site ~ '^[0-9]+$' THEN se.site::int END
        WHERE se."scanTime" >= ${wideFrom} AND se."scanTime" < ${wideUntil}
          AND (
            (se.outcome::text IN ('PUNCH_REJECTED', 'ERROR') AND e.id IS NOT NULL)
            OR (se."employeeId" IS NULL AND st.id IS NOT NULL)
          )`,
      db.gateRefusal.findMany({
        where: {
          tenantId,
          workDate: { gte: new Date(`${span.start}T00:00:00Z`), lte: new Date(`${span.end}T00:00:00Z`) },
        },
        select: {
          workDate: true, firstAt: true, reason: true, attempts: true, deviceName: true, employeeId: true,
          site: { select: { id: true, name: true, timezone: true } },
        },
      }),
    ]);

    const ids = [...new Set([...scans.map((s) => s.employeeId), ...refusals.map((r) => r.employeeId)].filter((x): x is string => !!x))];
    const people = ids.length
      ? await db.employee.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, wmsId: true, employeeCode: true, departmentId: true, user: { select: { name: true } }, department: { select: { name: true } } },
        })
      : [];
    const person = new Map(people.map((p) => [p.id, p]));
    const clock = (at: Date, tz: string) =>
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(at);

    let rows: Record<string, unknown>[] = [];
    for (const s of scans) {
      const tz = s.tz || REPORT_ZONE;
      const day = localDay(s.scanTime, tz);
      if (day < span.start || day > span.end) continue;
      const p = s.employeeId ? person.get(s.employeeId) : undefined;
      rows.push({
        date: day,
        time: clock(s.scanTime, tz),
        problem: p ? PROBLEM.rejected : PROBLEM.unknown,
        reason: p ? (s.rejectionReason ?? "Not recorded") : null,
        employeeName: p?.user?.name ?? null,
        employeeCode: p ? (p.wmsId ?? p.employeeCode) : s.badgeCode,
        badge: s.badgeCode,
        department: p?.department.name ?? null,
        departmentId: p?.departmentId ?? null,
        site: s.siteName,
        siteId: s.siteId,
        reader: s.deviceName,
        kind: s.stream === "SECURITY" ? "Security gate" : "Time clock",
        attempts: 1,
        at: s.scanTime.getTime(),
      });
    }
    for (const r of refusals) {
      const p = person.get(r.employeeId);
      if (!p) continue;
      const tz = r.site.timezone || REPORT_ZONE;
      rows.push({
        date: r.workDate.toISOString().slice(0, 10),
        time: clock(r.firstAt, tz),
        problem: PROBLEM.refused,
        reason: r.reason === "NOT_A_WORKDAY" ? "Scheduled off that day" : "No schedule for the day",
        employeeName: p.user?.name ?? null,
        employeeCode: p.wmsId ?? p.employeeCode,
        badge: p.wmsId ?? p.employeeCode,
        department: p.department.name,
        departmentId: p.departmentId,
        site: r.site.name,
        siteId: r.site.id,
        reader: r.deviceName,
        kind: "Security gate",
        attempts: r.attempts,
        at: r.firstAt.getTime(),
      });
    }

    // Every filter on the rows themselves, the site one included, which is
    // how a report is held to the sites its creator may see.
    rows = textFilter(rows, config.filters, ["problem", "employeeName", "employeeCode", "departmentId", "siteId"]);
    rows.sort((a, b) => (a.at as number) - (b.at as number));
    const sorted = sortRowsInMemory(rows, config.sortBy, {});
    const limited = config.limit ? sorted.slice(0, config.limit) : sorted;
    return { columns: cols, rows: limited, totalRows: sorted.length, period: { ...span, label: describeSpan(span) } };
  },
};
