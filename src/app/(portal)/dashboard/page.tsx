import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { format, differenceInMinutes } from "date-fns";
import { formatMinutes } from "@/lib/utils/duration";
import { parseUtcDate } from "@/lib/utils/date";
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

export default async function DashboardPage() {
  const session = await auth();
  const employeeId = session?.user?.employeeId ?? null;
  const now = new Date();
  const year = now.getFullYear();

  const [payPeriod, lastPunch, allLeaveBalances] = await Promise.all([
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
  ]);

  // Fetch current timesheet after payPeriod is known
  const currentTimesheet =
    payPeriod && employeeId
      ? await db.timesheet.findFirst({
          where: { employeeId, payPeriodId: payPeriod.id },
          include: { overtimeBuckets: true },
        })
      : null;

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
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Leave Balances — {year}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {allLeaveBalances.map((b) => (
              <div
                key={b.id}
                className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800"
              >
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {b.leaveType.name}
                </p>
                <p className="mt-1 text-lg font-bold text-zinc-900 dark:text-white">
                  {formatMinutes(b.balanceMinutes)}
                </p>
                <p className="text-xs text-zinc-400">
                  {(b.balanceMinutes / 60 / 8).toFixed(1)} days
                </p>
              </div>
            ))}
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
