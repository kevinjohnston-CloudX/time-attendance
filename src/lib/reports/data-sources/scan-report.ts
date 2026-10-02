import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DataSourceDefinition, ExecuteContext, ReportResult } from "./index";
import type { ReportConfig, FilterDef } from "@/lib/validators/report.schema";
import { daysOf, dayCount, describeSpan, REPORT_ZONE } from "../period";

/**
 * The two daily scan reports HR has always been sent: who came in and went
 * out of the building by the gate (the Security Scan Report) and by the time
 * clock (the Time Clock report).
 *
 * <p>One row per person per day. In time is their first arrival that day,
 * out time their last departure after it, and hours the gap between the two,
 * with nothing taken off for meals, exactly as the old files did. A person
 * with no departure yet has an in time and nothing after it.
 *
 * <p>Built from the tablets' own scan log, not from the timecard, because that
 * is what the old report was: a security officer comparing the two files is
 * comparing two independent records. The log is counted as the reader saw it,
 * so the rows the system wrote itself (an automatic close at night for
 * someone who never scanned out) are left out. A person who forgot to scan
 * out shows an in time and a blank out time, which is the finding.
 *
 * <p>A day belongs to the building's own time zone, so a 6:30 AM scan in
 * California is that Californian's day, not the next day in UTC. Everything
 * is counted in SQL: a month of every building is a few thousand rows, never
 * the scan log pulled into the web server to be counted there.
 */

type Stream = "SECURITY" | "TIME_CLOCK";

/**
 * The names the old files gave the two New Jersey buildings. They are not
 * the sites' own names here ("5903 Nj"), and the people reading these files
 * know them by the old ones. Any other building prints its own name.
 */
const LEGACY_WAREHOUSE_NAME: Record<number, string> = {
  5: "Bergen Logistics NJ3",
  13: "Bergen Logistics NJ299",
};

/** Scan sources whose rows describe what the system did, not what a reader saw. */
const SYSTEM_SOURCES = ["AUTO_CLOSE", "SEEDED"];

const MAX_DAYS = 366;

/**
 * Each column shows one name on screen and carries the old file's heading in
 * the download, so a spreadsheet that reads the file by heading keeps working.
 * The misspelled DEPARMENT is the old file's own and stays in the file only.
 */
const COLUMNS = [
  { id: "firstName", label: "First name", exportLabel: "FIRSTNAME", type: "string", defaultVisible: true },
  { id: "lastName", label: "Last name", exportLabel: "LASTNAME", type: "string", defaultVisible: true },
  { id: "wmsUserId", label: "WMS user ID", exportLabel: "WMSUSERID", type: "string", defaultVisible: true },
  { id: "agency", label: "Agency", exportLabel: "AGENCY", type: "string", defaultVisible: true },
  { id: "warehouseName", label: "Warehouse", exportLabel: "WAREHOUSENAME", type: "string", defaultVisible: true },
  { id: "employeeCode", label: "Employee ID", exportLabel: "EMPID", type: "string", defaultVisible: true },
  { id: "inTime", label: "In time", exportLabel: "INTIME", type: "string", defaultVisible: true },
  { id: "outTime", label: "Out time", exportLabel: "OUTTIME", type: "string", defaultVisible: true },
  { id: "hours", label: "Hours", exportLabel: "HOURS", type: "string", defaultVisible: true },
  { id: "department", label: "Department", exportLabel: "DEPARMENT", type: "string", defaultVisible: true },
  // Not in the old single day file. It is added on its own whenever the
  // report spans more than one day, since a row would not say which day it is.
  { id: "date", label: "Date", exportLabel: "DATE", type: "string", defaultVisible: false },
] as const;

type Row = {
  employeeId: string;
  firstName: string;
  lastName: string;
  wmsUserId: string | null;
  agency: string | null;
  warehouseName: string;
  employeeCode: string;
  inTime: string;
  outTime: string | null;
  hours: string | null;
  department: string;
  date: string;
  total: bigint;
};

/** What each sortable column sorts by. Constants only, never user text. */
const SORTABLE: Record<string, string> = {
  firstName: `"firstName"`,
  lastName: `"lastName"`,
  wmsUserId: `lpad(COALESCE("wmsUserId", ''), 12, '0')`,
  agency: `"agency"`,
  warehouseName: `"warehouseName"`,
  employeeCode: `"employeeCode"`,
  inTime: `"inAt"`,
  outTime: `"outAt"`,
  hours: `"hours"`,
  department: `"department"`,
  date: `"date"`,
};

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

function textCondition(expr: Prisma.Sql, f: FilterDef): Prisma.Sql | null {
  const one = String(Array.isArray(f.value) ? f.value[0] ?? "" : f.value);
  const many = (Array.isArray(f.value) ? f.value : [f.value]).map(String).filter(Boolean);
  switch (f.operator) {
    case "eq":
      return Prisma.sql`${expr} = ${one}`;
    case "neq":
      return Prisma.sql`${expr} <> ${one}`;
    case "in":
      return many.length ? Prisma.sql`${expr} IN (${Prisma.join(many)})` : null;
    case "notIn":
      return many.length ? Prisma.sql`${expr} NOT IN (${Prisma.join(many)})` : null;
    case "contains":
      return Prisma.sql`${expr} ILIKE ${"%" + escapeLike(one) + "%"}`;
    default:
      return null;
  }
}

function filterConditions(filters: FilterDef[]): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  for (const f of filters) {
    const expr = {
      siteId: Prisma.sql`"siteIdF"`,
      departmentId: Prisma.sql`"departmentId"`,
      employeeName: Prisma.sql`"fullName"`,
      employeeCode: Prisma.sql`"employeeCode"`,
      agency: Prisma.sql`"agency"`,
    }[f.field];
    if (!expr) continue;
    const c = textCondition(expr, f);
    if (c) out.push(c);
  }
  return out;
}

/** yyyy-mm-dd plus a number of days, as a UTC midnight timestamp string. */
function utcStamp(day: string, plusDays: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + plusDays)).toISOString().slice(0, 19).replace("T", " ");
}

async function execute(stream: Stream, config: ReportConfig, tenantId: string, ctx?: ExecuteContext): Promise<ReportResult> {
  const span = daysOf(config.dateRange, ctx?.timezone ?? REPORT_ZONE, ctx?.now);
  if (!span.start || !span.end || span.end < span.start) throw new Error("Pick the first and last day.");
  if (dayCount(span) > MAX_DAYS) throw new Error("Pick a period of one year or less.");

  // A building's day can start up to a day either side of UTC midnight, so the
  // scans are read a day wider and the days are cut exactly below.
  const from = utcStamp(span.start, -1);
  const to = utcStamp(span.end, 2);
  const conditions = filterConditions(config.filters);
  const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  const order = config.sortBy.filter((s) => SORTABLE[s.field]);
  const orderBy = order.length
    ? Prisma.raw(order.map((s) => `${SORTABLE[s.field]} ${s.direction === "desc" ? "DESC" : "ASC"} NULLS LAST`).join(", ") + `, "inAt" ASC, "employeeId" ASC`)
    : Prisma.raw(`"warehouseName" ASC, "date" ASC, "inAt" ASC, "employeeId" ASC`);

  const rows = await db.$queryRaw<Row[]>`
    WITH scans AS (
      SELECT se."employeeId", se."direction"::text AS direction, se."scanTime",
             COALESCE(st.timezone, ${REPORT_ZONE}) AS tz, st.id AS "siteId", st.name AS "siteName",
             st."wmsWarehouseId" AS "warehouseId", se."site" AS "siteCode",
             ((se."scanTime" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(st.timezone, ${REPORT_ZONE}))::date AS "localDay"
        FROM "scan_events" se
        JOIN "employees" e ON e.id = se."employeeId"
        LEFT JOIN "sites" st ON st."tenantId" = ${tenantId}
                            AND st."wmsWarehouseId" = CASE WHEN se."site" ~ '^[0-9]+$' THEN se."site"::int END
       WHERE se."stream" = ${stream}::"ScanStream"
         AND e."tenantId" = ${tenantId}
         AND se."direction"::text IN ('IN', 'OUT')
         AND se."directionSource"::text NOT IN (${Prisma.join(SYSTEM_SOURCES)})
         AND se."scanTime" >= ${from}::timestamp
         AND se."scanTime" <  ${to}::timestamp
    ),
    firsts AS MATERIALIZED (
      SELECT DISTINCT ON ("employeeId", "localDay")
             "employeeId", "localDay", "scanTime" AS in_t, tz, "siteId", "siteName", "warehouseId", "siteCode"
        FROM scans WHERE direction = 'IN'
       ORDER BY "employeeId", "localDay", "scanTime"
    ),
    -- Every day's first arrival and every departure in one time ordered line
    -- per person. Each departure is handed to the arrival it follows, and each
    -- arrival takes the latest departure inside 24 hours of it, all in window
    -- passes. Joining departures back to arrivals row by row looked the same
    -- and took ten seconds for a month, because the planner repeats a join
    -- like that once per row.
    events AS MATERIALIZED (
      SELECT "employeeId", in_t AS "scanTime", 'F' AS kind, tz, "siteId", "siteName", "warehouseId", "siteCode", "localDay"
        FROM firsts
      UNION ALL
      SELECT "employeeId", "scanTime", 'O', NULL, NULL, NULL, NULL, NULL, NULL
        FROM scans WHERE direction = 'OUT'
    ),
    tagged AS MATERIALIZED (
      SELECT *,
             MAX(CASE WHEN kind = 'F' THEN "scanTime" END)
               OVER (PARTITION BY "employeeId" ORDER BY "scanTime", kind) AS in_t
        FROM events
    ),
    ended AS MATERIALIZED (
      SELECT *,
             MAX(CASE WHEN kind = 'O' AND "scanTime" < in_t + interval '24 hours' THEN "scanTime" END)
               OVER (PARTITION BY "employeeId", in_t) AS out_t
        FROM tagged
    ),
    paired AS (
      SELECT "employeeId", in_t, out_t, tz, "siteId", "siteName", "warehouseId", "siteCode", "localDay"
        FROM ended
       WHERE kind = 'F' AND "localDay" BETWEEN ${span.start}::date AND ${span.end}::date
    ),
    shaped AS (
      SELECT p."employeeId",
             nm."fullName",
             split_part(nm."fullName", ' ', 1) AS "firstName",
             substr(nm."fullName", length(split_part(nm."fullName", ' ', 1)) + 2) AS "lastName",
             (SELECT MIN(sd."oracleUsersId") FROM "schedule_days" sd WHERE sd."employeeId" = e.id) AS "wmsUserId",
             a.description AS agency,
             CASE p."warehouseId"
               WHEN 5 THEN ${LEGACY_WAREHOUSE_NAME[5]}
               WHEN 13 THEN ${LEGACY_WAREHOUSE_NAME[13]}
               ELSE COALESCE(p."siteName", p."siteCode", '')
             END AS "warehouseName",
             e."employeeCode" AS "employeeCode",
             to_char((p.in_t AT TIME ZONE 'UTC') AT TIME ZONE p.tz, 'HH12:MI:SS AM') AS "inTime",
             to_char((p.out_t AT TIME ZONE 'UTC') AT TIME ZONE p.tz, 'HH12:MI:SS AM') AS "outTime",
             to_char(p.out_t - p.in_t, 'HH24:MI:SS') AS hours,
             dep.name AS department,
             dep.id AS "departmentId",
             p."siteId" AS "siteIdF",
             to_char(p."localDay", 'YYYY-MM-DD') AS date,
             p.in_t AS "inAt", p.out_t AS "outAt"
        FROM paired p
        JOIN "employees" e ON e.id = p."employeeId"
        JOIN "users" u ON u.id = e."userId"
        CROSS JOIN LATERAL (SELECT regexp_replace(btrim(u.name), '[[:space:]]+', ' ', 'g') AS "fullName") nm
        JOIN "departments" dep ON dep.id = e."departmentId"
        LEFT JOIN "agencies" a ON a.id = e."agencyId"
    )
    SELECT "employeeId", "firstName", "lastName", "wmsUserId", agency, "warehouseName", "employeeCode",
           "inTime", "outTime", hours, department, date, COUNT(*) OVER () AS total
      FROM shaped
      ${where}
     ORDER BY ${orderBy}
     LIMIT ${config.limit ?? 5000}
  `;

  const multiDay = span.start !== span.end;
  const wanted = new Set(config.columns);
  const shown = COLUMNS.filter((c) => wanted.has(c.id) || (multiDay && c.id === "date"));
  return {
    columns: shown.map((c) => ({ id: c.id, label: c.label, exportLabel: c.exportLabel, type: c.type })),
    rows: rows.map((r) => ({ ...r, total: undefined, employeeId: undefined })),
    totalRows: rows.length ? Number(rows[0].total) : 0,
    period: { start: span.start, end: span.end, label: describeSpan(span) },
  };
}

function source(id: "SECURITY_SCAN" | "TIME_CLOCK_SCAN", stream: Stream, label: string, description: string): DataSourceDefinition {
  return {
    id,
    label,
    description,
    icon: stream === "SECURITY" ? "ShieldCheck" : "Clock",
    brand: "CloudTime",
    columns: COLUMNS.map((c) => ({ ...c })),
    filters: [
      { id: "siteId", label: "Warehouse", type: "string", operators: ["eq", "in"] },
      { id: "departmentId", label: "Department", type: "string", operators: ["eq", "in"] },
      { id: "agency", label: "Agency", type: "string", operators: ["contains", "eq"] },
      { id: "employeeName", label: "Employee name", type: "string", operators: ["contains", "eq"] },
      { id: "employeeCode", label: "Employee ID", type: "string", operators: ["contains", "eq"] },
    ],
    groupableFields: [],
    fieldMap: {},
    execute: (config, tenantId, ctx) => execute(stream, config, tenantId, ctx),
  };
}

export const securityScanSource = source(
  "SECURITY_SCAN",
  "SECURITY",
  "Security scan report",
  "Each person's first gate arrival and last gate departure for the day, with hours between them."
);

export const timeClockScanSource = source(
  "TIME_CLOCK_SCAN",
  "TIME_CLOCK",
  "Time clock report",
  "Each person's first clock in and last clock out for the day, with hours between them."
);
