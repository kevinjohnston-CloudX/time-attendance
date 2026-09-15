import { NextRequest, NextResponse } from "next/server";
import { findScanDiscrepancies } from "@/lib/services/scan-event.service";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Ad-hoc view of tablet-vs-timecard discrepancies, for IT and payroll to query
 * directly without waiting for the nightly sweep or hunting through supervisor
 * exception views.
 *
 * Same finding set the cron raises exceptions from — this one just returns it,
 * including the scans that have no timesheet to attach an exception to, which
 * are invisible in the supervisor workflow by definition.
 *
 * GET /api/reports/scan-discrepancies?from=2026-09-01&to=2026-09-16
 */

const MAX_WINDOW_DAYS = 62;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Scoped to the caller's tenant — this exposes badge numbers and device
  // names, so it follows the same boundary as every other report.
  const employee = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { tenantId: true, role: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "No employee record" }, { status: 403 });
  }

  const allowed = ["SUPERVISOR", "PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"];
  if (!allowed.includes(employee.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const toParam = params.get("to");
  const fromParam = params.get("from");

  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();
  const from = fromParam
    ? new Date(`${fromParam}T00:00:00.000Z`)
    : new Date(to.getTime() - 7 * 86_400_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid from/to date" }, { status: 400 });
  }
  if (from >= to) {
    return NextResponse.json({ error: "`from` must be before `to`" }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
    return NextResponse.json(
      { error: `Window is limited to ${MAX_WINDOW_DAYS} days` },
      { status: 400 }
    );
  }

  const rows = await findScanDiscrepancies(from, to, employee.tenantId);

  const byKind = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    window: { from: from.toISOString(), to: to.toISOString() },
    total: rows.length,
    byKind,
    rows,
  });
}
