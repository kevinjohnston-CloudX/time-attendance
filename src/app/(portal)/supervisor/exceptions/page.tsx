import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamExceptions, getExceptionTypeCounts } from "@/actions/supervisor.actions";
import { ExceptionsScreen, type ExceptionRow } from "@/components/supervisor/exceptions-screen";
import { db } from "@/lib/db";
import { format } from "date-fns";

/**
 * Exceptions, rebuilt from the Claude Design handoff.
 *
 * <p>The split pane is kept, because resolving an exception means editing that
 * person's punches and the people who use this screen work down one employee
 * at a time: open Marcus, clear his four, move on. A flat table sorted by date
 * makes that four separate trips.
 *
 * <p>What changed is the frame around it. The page scrolls as one instead of
 * being a fixed-height pane with two independent scrollers, the bar carrying
 * the title, the search and the filters pins to the top, and the rail of
 * people pins underneath it.
 *
 * <p>This half fetches and flattens. Everything the screen draws, and every
 * filter that does not change the query, lives in the client half.
 */

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH:    "Missing Punch",
  ABSENT:           "Absent",
  SCAN_DISCREPANCY: "Scan Discrepancy",
  MISSED_MEAL:      "Missed Meal",
  SHORT_BREAK:      "Short Break",
  LONG_SHIFT:       "Long Shift",
  UNSCHEDULED_OT:   "Unscheduled OT",
  LATE_IN:          "Late In",
  EARLY_OUT:        "Early Out",
  CONSECUTIVE_DAYS: "Consecutive Days",
};

type Filters = {
  siteId?: string;
  departmentId?: string;
  shiftId?: string;
  employeeId?: string;
  exceptionType?: string;
  payPeriodId?: string;
};

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const { siteId, departmentId, shiftId, employeeId, exceptionType, payPeriodId } =
    await searchParams;
  const tenantId = session.user.tenantId as string;
  const now = new Date();

  const [result, counts, sites, departments, shifts, reasonCodes, rawPayPeriods] = await Promise.all([
    getTeamExceptions({ siteId, departmentId, shiftId, exceptionType, payPeriodId }),
    // Taken without the type filter on purpose, so the type control can say
    // what picking a different one would get you.
    getExceptionTypeCounts({ siteId, departmentId, shiftId, payPeriodId }),
    db.site.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.department.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(siteId ? { sites: { some: { siteId } } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.shift.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ number: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    // Read here rather than through getReasonCodes, which sits behind
    // PAY_PERIOD_MANAGE and would refuse the supervisors this screen is for.
    // The page has already checked the permission it does need.
    db.reasonCode.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, label: true },
    }),
    db.payPeriod.findMany({
      where: {
        tenantId,
        timesheets: { some: { exceptions: { some: { resolvedAt: null } } } },
      },
      orderBy: { startDate: "desc" },
      select: { id: true, startDate: true, endDate: true, status: true },
    }),
  ]);

  if (!result.success) redirect("/supervisor");

  const payPeriods = rawPayPeriods.map((pp) => {
    const isCurrent = pp.startDate <= now && pp.endDate >= now && pp.status === "OPEN";
    return {
      id: pp.id,
      name: `${format(pp.startDate, "MMM d")} to ${format(pp.endDate, "MMM d, yyyy")}${isCurrent ? " (Current)" : ""}`,
    };
  });

  /** Flattened here, so the client half never carries a shape it does not draw. */
  const rows: ExceptionRow[] = result.data.map((ex) => ({
    id: ex.id,
    exceptionType: ex.exceptionType,
    description: ex.description,
    occurredAt: ex.occurredAt,
    timesheetId: ex.timesheetId,
    employeeId: ex.timesheet.employeeId,
    employeeName: ex.timesheet.employee.user?.name ?? `Employee ${ex.timesheet.employeeId}`,
    siteName: ex.timesheet.employee.site?.name ?? null,
    departmentName: ex.timesheet.employee.department?.name ?? null,
    payPeriod: ex.timesheet.payPeriod,
    hasPunches: ex.timesheet.hasPunches,
    scheduled: ex.scheduled,
    recorded: ex.recorded,
  }));

  return (
    <ExceptionsScreen
      rows={rows}
      typeCounts={counts.success ? counts.data : {}}
      typeLabels={EXCEPTION_LABEL}
      sites={sites}
      departments={departments}
      shifts={shifts}
      payPeriods={payPeriods}
      reasonCodes={reasonCodes}
      selected={{ siteId, departmentId, shiftId, employeeId, exceptionType, payPeriodId }}
    />
  );
}
