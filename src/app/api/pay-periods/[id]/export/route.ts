import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { format } from "date-fns";

function esc(val: unknown): string {
  const s = val == null ? "" : String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

function toHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const exportFormat = req.nextUrl.searchParams.get("format") ?? "summary";

  const payPeriod = await db.payPeriod.findUnique({
    where: { id },
    select: { id: true, startDate: true, endDate: true, tenantId: true },
  });
  if (!payPeriod) return new NextResponse("Not found", { status: 404 });

  const tenantId = session.user.tenantId;
  if (tenantId && payPeriod.tenantId !== tenantId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const periodLabel = `${format(payPeriod.startDate, "yyyy-MM-dd")}_to_${format(payPeriod.endDate, "yyyy-MM-dd")}`;

  let csv = "";
  let filename = "";

  if (exportFormat === "summary") {
    const timesheets = await db.timesheet.findMany({
      where: { payPeriodId: id },
      include: {
        employee: {
          include: {
            user: { select: { name: true } },
            site: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        overtimeBuckets: true,
      },
      orderBy: { employee: { user: { name: "asc" } } },
    });

    const rows = timesheets.map((ts) => {
      const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
      const ot  = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
      const dt  = ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;
      return [
        ts.employee.user?.name ?? "",
        ts.employee.employeeCode,
        ts.employee.site?.name ?? "",
        ts.employee.department?.name ?? "",
        toHours(reg),
        toHours(ot),
        toHours(dt),
        toHours(reg + ot + dt),
        ts.status,
      ];
    });

    csv = toCsv(
      ["Employee Name", "Employee Code", "Site", "Department", "REG Hrs", "OT Hrs", "DT Hrs", "Total Hrs", "Status"],
      rows
    );
    filename = `timesheet-summary_${periodLabel}.csv`;

  } else if (exportFormat === "punches") {
    const punches = await db.punch.findMany({
      where: { timesheet: { payPeriodId: id }, correctedById: null },
      include: {
        employee: { include: { user: { select: { name: true } } } },
      },
      orderBy: [
        { employee: { user: { name: "asc" } } },
        { roundedTime: "asc" },
      ],
    });

    const rows = punches.map((p) => [
      p.employee.user?.name ?? "",
      p.employee.employeeCode,
      format(p.roundedTime, "MM/dd/yyyy"),
      format(p.roundedTime, "hh:mm a"),
      p.punchType,
      p.source,
      p.stateAfter,
      p.isApproved ? "Yes" : "No",
      p.note ?? "",
    ]);

    csv = toCsv(
      ["Employee Name", "Employee Code", "Date", "Time", "Punch Type", "Source", "State After", "Approved", "Note"],
      rows
    );
    filename = `punch-detail_${periodLabel}.csv`;

  } else if (exportFormat === "exceptions") {
    const exceptions = await db.exception.findMany({
      where: { timesheet: { payPeriodId: id } },
      include: {
        timesheet: {
          include: {
            employee: { include: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: [
        { timesheet: { employee: { user: { name: "asc" } } } },
        { occurredAt: "asc" },
      ],
    });

    const rows = exceptions.map((ex) => [
      ex.timesheet.employee.user?.name ?? "",
      ex.timesheet.employee.employeeCode,
      ex.exceptionType,
      format(ex.occurredAt, "MM/dd/yyyy"),
      ex.description,
      ex.resolvedAt ? "Yes" : "No",
      ex.resolution ?? "",
    ]);

    csv = toCsv(
      ["Employee Name", "Employee Code", "Exception Type", "Date", "Description", "Resolved", "Resolution"],
      rows
    );
    filename = `exceptions_${periodLabel}.csv`;

  } else {
    return new NextResponse("Invalid format", { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
