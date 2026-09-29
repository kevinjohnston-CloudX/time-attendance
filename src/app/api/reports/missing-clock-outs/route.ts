import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";

/** The widest window one request may cover, and the most people it returns. */
const MAX_DAYS = 93;
const MAX_ROWS = 5000;

/**
 * Who is not clocking out.
 *
 * <p>Every row the nightly auto-close writes is an employee who was still
 * showing IN at 23:00 with no exit scan, so counting those rows per employee
 * answers the question directly — no inference, no heuristic.
 *
 * <p>Query params:
 *   from, to   ISO dates (default: the last 30 days)
 *   minCount   only employees with at least this many (default 1)
 *   format     "json" (default) or "csv"
 *
 * <p>Note this counts scan-log closures, which is not the same as the timecard
 * sweep in /api/cron/auto-clock-out. A person can appear here and not there:
 * the readers are one record and the timecard another, and the whole point of
 * scan_events is that the two can disagree.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Names, badge codes and sites of the people in it: report managers,
  // payroll or Live Attendance company-wide only, and only for the caller's own company.
  // Anything else answers "not found".
  const session = await auth();
  const notFound = NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  if (!session?.user || session.user.isActive === false) return notFound;
  const allowed =
    (await userHasPermission(session.user, "REPORT_MANAGE")) ||
    (await userHasPermission(session.user, "TIMECARD_VIEW_ANY")) ||
    (await userHasPermission(session.user, "PRESENCE_VIEW_ANY"));
  if (!allowed) return notFound;
  const tenantId =
    session.user.role === "SUPER_ADMIN"
      ? (await cookies()).get(SUPER_ADMIN_TENANT_COOKIE)?.value ?? null
      : session.user.tenantId ?? null;
  if (!tenantId) return notFound;

  const { searchParams } = new URL(req.url);

  const to = searchParams.get("to")
    ? new Date(`${searchParams.get("to")}T23:59:59.999Z`)
    : new Date();
  const from = searchParams.get("from")
    ? new Date(`${searchParams.get("from")}T00:00:00.000Z`)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const minCount = Number(searchParams.get("minCount") ?? 1);
  const format = searchParams.get("format") ?? "json";

  if (Number.isNaN(+from) || Number.isNaN(+to)) {
    return NextResponse.json({ success: false, error: "Invalid from/to date" }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_DAYS * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ success: false, error: `Pick at most ${MAX_DAYS} days` }, { status: 400 });
  }

  const rows = await db.$queryRaw<
    Array<{
      employeeId: string | null;
      badgeCode: string;
      name: string | null;
      occurrences: bigint;
      timeClock: bigint;
      security: bigint;
      firstSeen: Date;
      lastSeen: Date;
      sites: string[];
    }>
  >`
    SELECT s."employeeId",
           MIN(s."badgeCode")            AS "badgeCode",
           MIN(u."name")                 AS "name",
           COUNT(*)                      AS "occurrences",
           COUNT(*) FILTER (WHERE s."stream" = 'TIME_CLOCK') AS "timeClock",
           COUNT(*) FILTER (WHERE s."stream" = 'SECURITY')   AS "security",
           MIN(s."scanTime")             AS "firstSeen",
           MAX(s."scanTime")             AS "lastSeen",
           ARRAY_AGG(DISTINCT s."site") FILTER (WHERE s."site" IS NOT NULL) AS "sites"
    FROM   "scan_events" s
    LEFT   JOIN "employees" e ON e."id" = s."employeeId"
    LEFT   JOIN "users" u     ON u."id" = e."userId"
    WHERE  s."directionSource" = 'AUTO_CLOSE'
      AND  s."tenantId" = ${tenantId}
      AND  s."scanTime" >= ${from}
      AND  s."scanTime" <= ${to}
    GROUP  BY s."employeeId"
    HAVING COUNT(*) >= ${minCount}
    ORDER  BY COUNT(*) DESC, MAX(s."scanTime") DESC
    LIMIT  ${MAX_ROWS}
  `;

  const data = rows.map((r) => ({
    employeeId: r.employeeId,
    badgeCode: r.badgeCode,
    name: r.name,
    missedClockOuts: Number(r.occurrences),
    timeClock: Number(r.timeClock),
    security: Number(r.security),
    firstSeen: r.firstSeen,
    lastSeen: r.lastSeen,
    sites: r.sites ?? [],
  }));

  if (format === "csv") {
    const esc = (v: unknown) => {
      // A leading = + - or @ would run as a formula when the file opens in Excel.
      const raw = v == null ? "" : String(v);
      const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "badgeCode,name,missedClockOuts,timeClock,security,firstSeen,lastSeen,sites";
    const body = data
      .map((d) =>
        [d.badgeCode, d.name, d.missedClockOuts, d.timeClock, d.security, d.firstSeen.toISOString(),
         d.lastSeen.toISOString(), d.sites.join(" ")].map(esc).join(","),
      )
      .join("\n");
    return new NextResponse(`${header}\n${body}\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="missing-clock-outs.csv"`,
      },
    });
  }

  return NextResponse.json({
    success: true,
    from: from.toISOString(),
    to: to.toISOString(),
    employees: data.length,
    totalMissedClockOuts: data.reduce((n, d) => n + d.missedClockOuts, 0),
    data,
  });
}
