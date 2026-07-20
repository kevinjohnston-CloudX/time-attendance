import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { format, differenceInMinutes } from "date-fns";
import { formatMinutes } from "@/lib/utils/duration";
import { parseUtcDate } from "@/lib/utils/date";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { OverviewPeriodFilter } from "@/components/dashboard/overview-period-filter";
import { SubmitTimesheetButton } from "@/components/time/submit-timesheet-button";
import {
  TIMESHEET_STATUS_LABEL,
  type TimesheetStatusValue,
} from "@/lib/state-machines/labels";

const STATUS_BADGE: Record<string, string> = {
  OPEN:             "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  SUBMITTED:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SUP_APPROVED:     "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  PAYROLL_APPROVED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  LOCKED:           "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

const PUNCH_STATE_LABEL: Record<string, string> = {
  WORK:  "Working",
  MEAL:  "Meal Break",
  BREAK: "On Break",
  OUT:   "Clocked Out",
};

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH:    "Missing Punch",
  LONG_SHIFT:       "Long Shift",
  SHORT_BREAK:      "Short Break",
  MISSED_MEAL:      "Missed Meal",
  UNSCHEDULED_OT:   "Unscheduled OT",
  CONSECUTIVE_DAYS: "Consecutive Days",
  ABSENT:           "Absent",
};

const EXCEPTION_BADGE: Record<string, string> = {
  MISSING_PUNCH:    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  LONG_SHIFT:       "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  SHORT_BREAK:      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  MISSED_MEAL:      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  UNSCHEDULED_OT:   "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  CONSECUTIVE_DAYS: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  ABSENT:           "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const LEAVE_STATUS_LABEL: Record<string, string> = {
  DRAFT:     "Draft",
  PENDING:   "Pending",
  APPROVED:  "Approved",
  REJECTED:  "Rejected",
  CANCELLED: "Cancelled",
  POSTED:    "Posted",
};

const LEAVE_STATUS_BADGE: Record<string, string> = {
  DRAFT:     "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  PENDING:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  APPROVED:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  REJECTED:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  POSTED:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ overviewPeriodId?: string }>;
}) {
  const session = await auth();
  const employeeId = session?.user?.employeeId ?? null;
  const now = new Date();
  const year = now.getFullYear();
  const { overviewPeriodId } = (await searchParams) ?? {};

  const [payPeriod, lastPunch, allLeaveBalances, pendingLeaveRequests] = await Promise.all([
    db.payPeriod.findFirst({
      where: {
        startDate: { lte: now },
        endDate:   { gte: now },
        status: "OPEN",
      },
    }),

    employeeId
      ? db.punch.findFirst({
          where: { employeeId, isApproved: true, correctedById: null },
          orderBy: { punchTime: "desc" },
        })
      : null,

    employeeId
      ? db.leaveBalance.findMany({
          where: { employeeId, accrualYear: year },
          include: { leaveType: { select: { name: true } } },
          orderBy: { leaveType: { name: "asc" } },
        })
      : [],

    // Approved + submitted requests — approved reduces remaining, submitted shows as pending
    employeeId
      ? db.leaveRequest.findMany({
          where: { employeeId, status: { in: ["APPROVED", "PENDING"] } },
          select: { leaveTypeId: true, durationMinutes: true, status: true },
        })
      : [],
  ]);

  // Fetch current timesheet after payPeriod is known
  const currentTimesheet =
    payPeriod && employeeId
      ? await db.timesheet.findFirst({
          where: { employeeId, payPeriodId: payPeriod.id },
          include: { overtimeBuckets: true },
        })
      : null;

  // ── Payroll overview (PAY_PERIOD_MANAGE only) ────────────────────────────
  const tenantId = (session?.user as { tenantId?: string } | undefined)?.tenantId;
  const hasPayrollAccess = session?.user
    ? await userHasPermission(session.user, "PAY_PERIOD_MANAGE")
    : false;

  let overviewFilterOptions: { id: string; label: string }[] = [];
  let selectedOverviewPeriodId = payPeriod?.id ?? "";
  let exceptionCounts: { exceptionType: string; _count: { _all: number } }[] = [];
  let leaveStatusCounts: { status: string; _count: { _all: number } }[] = [];
  let timesheetStatusCounts: { status: string; _count: { _all: number } }[] = [];

  if (hasPayrollAccess && tenantId) {
    // Fetch neighbouring pay periods for the filter dropdown
    const [prevPP, nextPP] = await Promise.all([
      payPeriod
        ? db.payPeriod.findFirst({
            where: { tenantId, endDate: { lt: payPeriod.startDate } },
            orderBy: { endDate: "desc" },
            select: { id: true, startDate: true, endDate: true },
          })
        : null,
      payPeriod
        ? db.payPeriod.findFirst({
            where: { tenantId, startDate: { gt: payPeriod.endDate } },
            orderBy: { startDate: "asc" },
            select: { id: true, startDate: true, endDate: true },
          })
        : null,
    ]);

    type PeriodOption = { id: string; startDate: Date; endDate: Date; label: string };
    const allPeriods: PeriodOption[] = [
      prevPP && {
        ...prevPP,
        label: `${format(parseUtcDate(prevPP.startDate), "MMM d")} – ${format(parseUtcDate(prevPP.endDate), "MMM d")} (Previous)`,
      },
      payPeriod && {
        id: payPeriod.id,
        startDate: payPeriod.startDate,
        endDate: payPeriod.endDate,
        label: `${format(parseUtcDate(payPeriod.startDate), "MMM d")} – ${format(parseUtcDate(payPeriod.endDate), "MMM d")} (Current)`,
      },
      nextPP && {
        ...nextPP,
        label: `${format(parseUtcDate(nextPP.startDate), "MMM d")} – ${format(parseUtcDate(nextPP.endDate), "MMM d")} (Next)`,
      },
    ].filter(Boolean) as PeriodOption[];

    overviewFilterOptions = allPeriods.map(({ id, label }) => ({ id, label }));

    const selectedPeriod =
      allPeriods.find((p) => p.id === overviewPeriodId) ??
      allPeriods.find((p) => p.id === payPeriod?.id) ??
      allPeriods[0];

    selectedOverviewPeriodId = selectedPeriod?.id ?? "";

    if (selectedPeriod) {
      [exceptionCounts, leaveStatusCounts, timesheetStatusCounts] = await Promise.all([
        db.exception.groupBy({
          by: ["exceptionType"],
          where: {
            resolvedAt: null,
            timesheet: { payPeriodId: selectedPeriod.id, employee: { tenantId } },
          },
          _count: { _all: true },
        }),
        db.leaveRequest.groupBy({
          by: ["status"],
          where: {
            employee: { tenantId },
            startDate: { gte: selectedPeriod.startDate, lte: selectedPeriod.endDate },
          },
          _count: { _all: true },
        }),
        db.timesheet.groupBy({
          by: ["status"],
          where: { payPeriodId: selectedPeriod.id, employee: { tenantId } },
          _count: { _all: true },
        }),
      ]);
    }
  }

  // ── Pay period display ────────────────────────────────────────────────────
  const payPeriodValue = payPeriod
    ? `${format(parseUtcDate(payPeriod.startDate), "MMM d")} – ${format(parseUtcDate(payPeriod.endDate), "MMM d")}`
    : "No active period";

  const payPeriodSub = payPeriod
    ? (() => {
        const end = parseUtcDate(payPeriod.endDate);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const daysLeft = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
        return daysLeft > 0
          ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`
          : "Ends today";
      })()
    : null;

  // ── Punch status ──────────────────────────────────────────────────────────
  const punchState = lastPunch?.stateAfter ?? "OUT";
  const isActive = punchState !== "OUT";
  const elapsedMinutes = isActive
    ? differenceInMinutes(now, lastPunch!.punchTime)
    : 0;

  const punchSub = isActive
    ? `${formatMinutes(elapsedMinutes)} elapsed`
    : lastPunch
    ? `Last: ${format(lastPunch.punchTime, "h:mm a")}`
    : "No punches recorded";

  // ── Pay period hours ──────────────────────────────────────────────────────
  const bucketMap = Object.fromEntries(
    (currentTimesheet?.overtimeBuckets ?? []).map((b) => [b.bucket, b.totalMinutes])
  );
  const regMin = bucketMap["REG"] ?? 0;
  const otMin  = bucketMap["OT"]  ?? 0;
  const dtMin  = bucketMap["DT"]  ?? 0;
  const totalMin = regMin + otMin + dtMin;

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Welcome back, {session?.user?.name ?? "there"}.
      </p>

      {/* ── Stat cards ── */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Pay Period */}
        <StatCard
          label="Pay Period"
          value={payPeriodValue}
          sub={payPeriodSub ?? undefined}
        />

        {/* Punch Status — employees only */}
        {employeeId && (
          <StatCard
            label="Punch Status"
            value={PUNCH_STATE_LABEL[punchState] ?? punchState}
            sub={punchSub}
            valueClassName={
              punchState === "WORK"
                ? "text-green-600 dark:text-green-400"
                : punchState === "MEAL" || punchState === "BREAK"
                ? "text-amber-600 dark:text-amber-400"
                : undefined
            }
          />
        )}

        {/* Pay Period Hours — employees only */}
        {employeeId && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Pay Period Hours
            </p>
            {currentTimesheet ? (
              <>
                <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
                  {formatMinutes(totalMin)}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {formatMinutes(regMin)} REG
                  </span>
                  {otMin > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {formatMinutes(otMin)} OT
                    </span>
                  )}
                  {dtMin > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {formatMinutes(dtMin)} DT
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">—</p>
                <p className="mt-1 text-xs text-zinc-400">No timesheet yet</p>
              </>
            )}
          </div>
        )}

        {/* Timesheet Status — employees only */}
        {employeeId && (
          <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Timesheet
            </p>
            {currentTimesheet ? (
              <div className="mt-2 flex flex-col gap-3">
                <span
                  className={`self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[currentTimesheet.status] ?? ""}`}
                >
                  {TIMESHEET_STATUS_LABEL[currentTimesheet.status as TimesheetStatusValue]}
                </span>

                {currentTimesheet.status === "OPEN" && currentTimesheet.rejectionNote && (
                  <p className="text-xs text-red-500 dark:text-red-400">
                    Returned: {currentTimesheet.rejectionNote}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  <Link
                    href={`/time/timesheet/${currentTimesheet.id}`}
                    className="text-xs text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                  >
                    View →
                  </Link>
                  {currentTimesheet.status === "OPEN" && (
                    <SubmitTimesheetButton timesheetId={currentTimesheet.id} />
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-400">
                No timesheet yet
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Leave Balances ── */}
      {employeeId && allLeaveBalances.length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Leave Balances — {year}
          </p>
          <div className="mt-3 grid grid-flow-col auto-cols-fr gap-3">
            {allLeaveBalances.map((b) => {
              const typeRequests    = pendingLeaveRequests.filter((r) => r.leaveTypeId === b.leaveTypeId);
              const approvedMinutes = typeRequests
                .filter((r) => r.status === "APPROVED")
                .reduce((sum, r) => sum + r.durationMinutes, 0);
              const submittedMinutes = typeRequests
                .filter((r) => r.status === "PENDING")
                .reduce((sum, r) => sum + r.durationMinutes, 0);
              const totalMinutes     = b.balanceMinutes + b.usedMinutes;
              const remainingMinutes = totalMinutes - b.usedMinutes - approvedMinutes;
              const hasBreakdown     = b.usedMinutes > 0 || approvedMinutes > 0 || submittedMinutes > 0;

              return (
                <div key={b.id} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {b.leaveType.name}
                  </p>

                  {/* Total / Remaining row */}
                  <div className="mt-1.5 flex gap-4">
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Total</p>
                      <p className="text-base font-bold text-zinc-900 dark:text-white">
                        {formatMinutes(totalMinutes)}
                      </p>
                      <p className="text-xs text-zinc-400">{(totalMinutes / 60 / 8).toFixed(1)}d</p>
                    </div>
                    <div className="w-px self-stretch bg-zinc-200 dark:bg-zinc-700" />
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Remaining</p>
                      <p className={`text-base font-bold ${remainingMinutes < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-white"}`}>
                        {formatMinutes(Math.max(remainingMinutes, 0))}
                      </p>
                      <p className="text-xs text-zinc-400">{(Math.max(remainingMinutes, 0) / 60 / 8).toFixed(1)}d</p>
                    </div>
                  </div>

                  {/* Breakdown */}
                  {hasBreakdown && (
                    <div className="mt-2 flex flex-wrap gap-3 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                      {b.usedMinutes > 0 && (
                        <div>
                          <p className="text-xs text-zinc-400">Used</p>
                          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                            {formatMinutes(b.usedMinutes)}
                          </p>
                        </div>
                      )}
                      {approvedMinutes > 0 && (
                        <div>
                          <p className="text-xs text-zinc-400">Approved</p>
                          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            {formatMinutes(approvedMinutes)}
                          </p>
                        </div>
                      )}
                      {submittedMinutes > 0 && (
                        <div>
                          <p className="text-xs text-zinc-400">Pending</p>
                          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            {formatMinutes(submittedMinutes)}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── General Overview (payroll only) ── */}
      {hasPayrollAccess && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">General Overview</h2>
            {overviewFilterOptions.length > 0 && (
              <OverviewPeriodFilter
                options={overviewFilterOptions}
                selectedId={selectedOverviewPeriodId}
              />
            )}
          </div>
          <div className="grid grid-cols-3 gap-4">

            {/* Exceptions by type */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Open Exceptions</p>
              <div className="flex flex-wrap gap-2">
                {exceptionCounts.length === 0 ? (
                  <p className="text-sm text-zinc-400">No open exceptions</p>
                ) : (
                  exceptionCounts.map((ec) => {
                    const params = new URLSearchParams({ exceptionType: ec.exceptionType });
                    if (selectedOverviewPeriodId) params.set("payPeriodId", selectedOverviewPeriodId);
                    return (
                      <Link
                        key={ec.exceptionType}
                        href={`/supervisor/exceptions?${params.toString()}`}
                        className="min-w-[100px] rounded-lg border border-zinc-100 bg-zinc-50 p-3 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                      >
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${EXCEPTION_BADGE[ec.exceptionType] ?? "bg-zinc-100 text-zinc-500"}`}>
                          {EXCEPTION_LABEL[ec.exceptionType] ?? ec.exceptionType}
                        </span>
                        <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
                          {ec._count._all}
                        </p>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>

            {/* Time-off requests by status */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Time-Off Requests
              </p>
              <div className="flex flex-wrap gap-2">
                {leaveStatusCounts.length === 0 ? (
                  <p className="text-sm text-zinc-400">No requests</p>
                ) : (
                  leaveStatusCounts.map((lc) => {
                    const leaveHref =
                      lc.status === "PENDING"
                        ? "/supervisor/leave?tab=pending"
                        : lc.status === "APPROVED"
                        ? "/supervisor/leave?tab=upcoming"
                        : null;
                    const tileClass = "min-w-[100px] rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800";
                    const inner = (
                      <>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${LEAVE_STATUS_BADGE[lc.status] ?? "bg-zinc-100 text-zinc-500"}`}>
                          {LEAVE_STATUS_LABEL[lc.status] ?? lc.status}
                        </span>
                        <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
                          {lc._count._all}
                        </p>
                      </>
                    );
                    return leaveHref ? (
                      <Link
                        key={lc.status}
                        href={leaveHref}
                        className={`${tileClass} transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-700`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div key={lc.status} className={tileClass}>
                        {inner}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Timesheets by status */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Timesheets — Open Pay Periods
              </p>
              <div className="flex flex-wrap gap-2">
                {timesheetStatusCounts.length === 0 ? (
                  <p className="text-sm text-zinc-400">No timesheets in open pay periods</p>
                ) : (
                  timesheetStatusCounts.map((tc) => (
                    <div
                      key={tc.status}
                      className="min-w-[100px] rounded-lg border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[tc.status] ?? "bg-zinc-100 text-zinc-500"}`}>
                        {TIMESHEET_STATUS_LABEL[tc.status as TimesheetStatusValue] ?? tc.status}
                      </span>
                      <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
                        {tc._count._all}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueClassName ?? "text-zinc-900 dark:text-white"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}
