import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { EXPORT_ROW_CAP, loadPunchExport } from "@/lib/punch-history/punch-history-data";

/**
 * Team Punch History, as a spreadsheet.
 *
 * <p>Who may call it: anyone the screen lets in, which is PUNCH_VIEW_TEAM.
 * Whose punches it holds: exactly the people the screen would list for the
 * same filters and search, because it reads through the same scope. A
 * supervisor gets their direct reports and nobody else, whatever the query
 * string says; payroll gets the company, or the site and department they
 * filtered to. Signed out is 401 and without the permission is 403, rather
 * than an empty file somebody could read as "nobody punched".
 */

/** RFC 4180: quote anything holding a comma, quote or newline, and double inner quotes. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to export." }, { status: 401 });
  if (!(await userHasPermission(session.user, "PUNCH_VIEW_TEAM"))) {
    return NextResponse.json({ error: "You do not have access to team punches." }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const result = await loadPunchExport(session.user, {
    startDate: sp.get("startDate") ?? undefined,
    endDate: sp.get("endDate") ?? undefined,
    siteId: sp.get("siteId") ?? undefined,
    departmentId: sp.get("departmentId") ?? undefined,
    q: sp.get("q") ?? undefined,
    show: sp.get("show") ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: `That is ${result.count.toLocaleString("en-US")} punches, more than the ${EXPORT_ROW_CAP.toLocaleString("en-US")} one file can hold. Pick a shorter date range, or filter by site or department.`,
      },
      { status: 422 },
    );
  }

  const header = [
    "Employee",
    "Badge ID",
    "Department",
    "Site",
    "Date",
    "Punch",
    "Actual time",
    "Rounded time",
    "Source",
    "Status",
    "Correction",
  ];
  const lines = [header.join(",")];
  for (const r of result.rows) {
    lines.push(
      [
        r.employee,
        r.badgeId,
        r.department,
        r.site,
        r.date,
        r.punchType,
        r.actual,
        r.rounded,
        r.source,
        r.status,
        r.isCorrection ? "Yes" : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const filename = `team-punch-history-${result.startDate}-to-${result.endDate}.csv`;
  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // Punches get approved and corrected all day, and a cached copy could be
      // the wrong person's copy.
      "cache-control": "no-store",
    },
  });
}
