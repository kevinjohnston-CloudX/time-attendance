import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { getTeamExceptions } from "@/actions/supervisor.actions";
import { formatTimeOfDay } from "@/lib/utils/date";

/**
 * The open exceptions, as a spreadsheet.
 *
 * <p>Built on the same server action the screen uses rather than its own
 * query. The action carries the permission check and the scope with it, so an
 * export can never widen what the person could already see: a supervisor
 * exports their own team, payroll exports the site they filtered to, and
 * somebody without the approval permission gets nothing at all. A second
 * hand-rolled query here would be a second place for that scope to drift.
 *
 * <p>Query params mirror the screen's own filters, so the file matches what
 * was on screen when the button was pressed.
 */

/** RFC 4180: quote anything holding a comma, quote or newline, and double inner quotes. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH:    "Missing Punch",
  ABSENT:           "Absent",
  MISSED_MEAL:      "Missed Meal",
  SHORT_BREAK:      "Short Break",
  LONG_SHIFT:       "Long Shift",
  UNSCHEDULED_OT:   "Unscheduled OT",
  CONSECUTIVE_DAYS: "Consecutive Days",
  LATE_IN:          "Late In",
  EARLY_OUT:        "Early Out",
  SCAN_DISCREPANCY: "Scan Discrepancy",
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  // Checked here rather than left to the action, where an unknown value is a
  // schema error and comes back as a refusal. A mistyped type in a link is
  // not the same thing as being told no.
  const typeParam = searchParams.get("exceptionType");
  const exceptionType = typeParam && typeParam in EXCEPTION_LABEL ? typeParam : undefined;

  const result = await getTeamExceptions({
    siteId: searchParams.get("siteId") ?? undefined,
    departmentId: searchParams.get("departmentId") ?? undefined,
    shiftId: searchParams.get("shiftId") ?? undefined,
    exceptionType,
    // The screen's period is a start day, matching every rule set's period.
    // A malformed day would fail the schema, so it is dropped here instead.
    payPeriodStart: /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("payPeriodStart") ?? "")
      ? searchParams.get("payPeriodStart")!
      : undefined,
  });

  if (!result.success) {
    // 403 rather than an empty file, so nobody reads "no rows" as "nothing
    // is open".
    return NextResponse.json({ success: false, error: result.error }, { status: 403 });
  }

  const employeeId = searchParams.get("employeeId") ?? undefined;
  const rows = employeeId
    ? result.data.filter((ex) => ex.timesheet.employeeId === employeeId)
    : result.data;

  const header = [
    "Employee",
    "Site",
    "Department",
    "Exception",
    "Date",
    "Scheduled in",
    "Scheduled out",
    "Recorded in",
    "Recorded out",
    "Pay period start",
    "Pay period end",
    "Detail",
  ];

  const lines = [header.join(",")];
  for (const ex of rows) {
    const emp = ex.timesheet.employee;
    lines.push(
      [
        emp.user?.name ?? "",
        emp.site?.name ?? "",
        emp.department?.name ?? "",
        EXCEPTION_LABEL[ex.exceptionType] ?? ex.exceptionType,
        format(ex.occurredAt, "yyyy-MM-dd"),
        // On a 12 hour clock, like every screen. A spreadsheet is read by
        // the same people.
        formatTimeOfDay(ex.scheduled.start) ?? "",
        formatTimeOfDay(ex.scheduled.end) ?? "",
        formatTimeOfDay(ex.recorded.in) ?? "",
        formatTimeOfDay(ex.recorded.out) ?? "",
        format(ex.timesheet.payPeriod.startDate, "yyyy-MM-dd"),
        format(ex.timesheet.payPeriod.endDate, "yyyy-MM-dd"),
        ex.description,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const filename = `exceptions-${format(new Date(), "yyyy-MM-dd")}.csv`;

  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // The queue changes as people resolve rows, and a cached copy would
      // also be the wrong person's copy.
      "cache-control": "no-store",
    },
  });
}
