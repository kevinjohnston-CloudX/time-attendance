import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import {
  getTeamLeaveRequests,
  getHrPendingLeave,
  getUpcomingTeamLeave,
} from "@/actions/supervisor.actions";

/**
 * The team leave queues, as a spreadsheet.
 *
 * <p>Deliberately built on the same three server actions the screen uses
 * rather than its own query. Those actions carry the permission check and the
 * scope with them, so an export can never widen what the person could already
 * see: a supervisor exports their own reports, payroll exports the site they
 * filtered to, and somebody with no approval permission gets nothing at all.
 * A hand-rolled query here would be a second place for that scope to drift.
 *
 * <p>Query params mirror the screen's own filters: `tab` (all | pending |
 * hr-pending | upcoming), plus siteId, departmentId and shiftId.
 */

/** RFC 4180: quote anything holding a comma, quote or newline, and double inner quotes. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function isoDay(d: Date | string): string {
  return (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab") ?? "all";
  const filters = {
    siteId: searchParams.get("siteId") ?? undefined,
    departmentId: searchParams.get("departmentId") ?? undefined,
    shiftId: searchParams.get("shiftId") ?? undefined,
  };

  const wanted =
    tab === "pending" || tab === "hr-pending" || tab === "upcoming" ? tab : "all";

  const [pending, hrPending, upcoming] = await Promise.all([
    wanted === "all" || wanted === "pending" ? getTeamLeaveRequests(filters) : null,
    wanted === "all" || wanted === "hr-pending" ? getHrPendingLeave(filters) : null,
    wanted === "all" || wanted === "upcoming" ? getUpcomingTeamLeave(filters) : null,
  ]);

  // Any one of the three refusing means the caller is not allowed to be here,
  // since all three sit behind the same permission. 403 rather than an empty
  // file, so nobody reads "no rows" as "nobody has leave".
  for (const result of [pending, hrPending, upcoming]) {
    if (result && !result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 403 });
    }
  }

  /** One exported row, shaped by hand so a change to any query is a type error here. */
  type ExportRow = {
    employee: { user: { name: string | null } | null; department: { name: string } | null };
    leaveType: { name: string };
    status: string;
    startDate: Date | string;
    endDate: Date | string;
    durationMinutes: number;
    submittedAt: Date | string | null;
    note: string | null;
  };
  const queues: { queue: string; rows: ExportRow[] }[] = [];
  if (pending?.success) queues.push({ queue: "Awaiting supervisor", rows: pending.data });
  if (hrPending?.success) queues.push({ queue: "Awaiting HR", rows: hrPending.data });
  if (upcoming?.success) queues.push({ queue: "Approved upcoming", rows: upcoming.data });

  const header = [
    "Queue",
    "Employee",
    "Department",
    "Leave type",
    "Status",
    "Start date",
    "End date",
    "Hours",
    "Filed",
    "Note",
  ];

  const lines = [header.join(",")];
  for (const { queue, rows } of queues) {
    for (const r of rows) {
      lines.push(
        [
          queue,
          r.employee.user?.name ?? "",
          r.employee.department?.name ?? "",
          r.leaveType.name,
          r.status,
          isoDay(r.startDate),
          isoDay(r.endDate),
          (r.durationMinutes / 60).toFixed(2),
          r.submittedAt ? isoDay(r.submittedAt) : "",
          r.note ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  const filename = `team-leave-${format(new Date(), "yyyy-MM-dd")}.csv`;

  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // A queue changes by the minute; a cached copy would be wrong almost
      // immediately and would also be the wrong person's copy.
      "cache-control": "no-store",
    },
  });
}
