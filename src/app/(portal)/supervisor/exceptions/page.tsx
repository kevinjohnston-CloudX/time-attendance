import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamExceptions, getExceptionTypeCounts } from "@/actions/supervisor.actions";
import { ExceptionsScreen, type ExceptionRow } from "@/components/supervisor/exceptions-screen";
import { db } from "@/lib/db";
import { parseUtcDate } from "@/lib/utils/date";
import { dayKey, periodLastDay, periodRange } from "@/lib/pay-period-display";

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
  /** YYYY-MM-DD: every period starting that day. */
  payPeriodStart?: string;
  /** Older links name one period; it is read as that period's start day. */
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

  const { siteId, departmentId, shiftId, employeeId, exceptionType, payPeriodId, ...rest } =
    await searchParams;
  const tenantId = session.user.tenantId as string;
  const now = new Date();

  // Pay Periods, the Dashboard and Team Overview link here with one period's
  // id. Found inside the caller's company, so another company's id is ignored.
  let payPeriodStart = /^\d{4}-\d{2}-\d{2}$/.test(rest.payPeriodStart ?? "") ? rest.payPeriodStart : undefined;
  if (!payPeriodStart && payPeriodId) {
    const linked = await db.payPeriod.findFirst({ where: { id: payPeriodId, tenantId }, select: { startDate: true } });
    if (linked) payPeriodStart = dayKey(parseUtcDate(linked.startDate));
  }

  const [result, counts, sites, departments, shifts, reasonCodes, rawPayPeriods] = await Promise.all([
    getTeamExceptions({ siteId, departmentId, shiftId, exceptionType, payPeriodStart }),
    // Taken without the type filter on purpose, so the type control can say
    // what picking a different one would get you.
    getExceptionTypeCounts({ siteId, departmentId, shiftId, payPeriodStart }),
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
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        ruleSet: { select: { payFrequency: true } },
        tenant: { select: { payFrequency: true } },
      },
    }),
  ]);

  if (!result.success) redirect("/supervisor");

  // One choice per start date, not per period: a company runs a period per
  // rule set over the same dates, and picking one period used to show one
  // rule set's people. The id is the day; the last day follows the
  // period's own frequency, since monthly periods store their last day and
  // weekly ones the day after.
  const seenStarts = new Set<string>();
  const payPeriods: { id: string; name: string }[] = [];
  for (const pp of rawPayPeriods) {
    const startKey = dayKey(parseUtcDate(pp.startDate));
    if (seenStarts.has(startKey)) continue;
    seenStarts.add(startKey);
    const frequency = pp.ruleSet?.payFrequency ?? pp.tenant.payFrequency;
    const isCurrent = pp.startDate <= now && pp.endDate >= now && pp.status === "OPEN";
    payPeriods.push({
      id: startKey,
      name: `${periodRange(pp.startDate, periodLastDay(pp.endDate, frequency))}${isCurrent ? " (Current)" : ""}`,
    });
  }

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
    payPeriod: {
      id: ex.timesheet.payPeriod.id,
      // Worked out here, in UTC, so the browser's zone cannot move a day.
      label: periodRange(
        ex.timesheet.payPeriod.startDate,
        periodLastDay(ex.timesheet.payPeriod.endDate, ex.timesheet.payPeriod.ruleSet?.payFrequency ?? ex.timesheet.payPeriod.tenant.payFrequency),
      ),
    },
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
      selected={{ siteId, departmentId, shiftId, employeeId, exceptionType, payPeriodStart }}
    />
  );
}
