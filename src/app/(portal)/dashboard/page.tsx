import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { format } from "date-fns";
import { formatMinutes } from "@/lib/utils/duration";
import { parseUtcDate } from "@/lib/utils/date";

export default async function DashboardPage() {
  const session = await auth();
  const employeeId = session?.user?.employeeId ?? null;

  const now = new Date();
  const year = now.getFullYear();

  // Current week bounds (Mon–Sun) as UTC midnight dates for @db.Date comparisons
  const dayOfWeek = now.getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceMon = (dayOfWeek + 6) % 7;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMon));
  const weekEnd   = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 6));

  const [payPeriod, weekSegments, ptoBalances] = await Promise.all([
    // Active pay period that contains today
    db.payPeriod.findFirst({
      where: {
        startDate: { lte: now },
        endDate:   { gte: now },
        status: "OPEN",
      },
    }),

    // Work segments for the current week
    employeeId
      ? db.workSegment.findMany({
          where: {
            timesheet: { employeeId },
            segmentType: "WORK",
            segmentDate: { gte: weekStart, lte: weekEnd },
          },
        })
      : [],

    // PTO leave balances for the current accrual year
    employeeId
      ? db.leaveBalance.findMany({
          where: {
            employeeId,
            accrualYear: year,
            leaveType: { category: "PTO" },
          },
        })
      : [],
  ]);

  const weekMinutes = weekSegments.reduce((a, s) => a + s.durationMinutes, 0);
  const ptoMinutes  = ptoBalances.reduce((a, b) => a + b.balanceMinutes, 0);

  const payPeriodValue = payPeriod
    ? `${format(parseUtcDate(payPeriod.startDate), "MMM d")} – ${format(parseUtcDate(payPeriod.endDate), "MMM d")}`
    : "No active period";

  const payPeriodSub = payPeriod
    ? (() => {
        const end = parseUtcDate(payPeriod.endDate);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const daysLeft = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
        return daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining` : "Ends today";
      })()
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Dashboard</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Welcome back, {session?.user?.name ?? "there"}.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Pay Period"
          value={payPeriodValue}
          sub={payPeriodSub ?? undefined}
        />
        <StatCard
          label="Hours This Week"
          value={formatMinutes(weekMinutes)}
          sub={weekMinutes === 0 ? "No punches recorded yet" : undefined}
        />
        <StatCard
          label="PTO Balance"
          value={ptoMinutes > 0 ? formatMinutes(ptoMinutes) : "—"}
          sub={ptoMinutes > 0 ? `${Math.floor(ptoMinutes / 60 / 8)} days` : "No balance on record"}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}
