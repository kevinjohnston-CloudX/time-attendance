import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getPayPeriods } from "@/actions/pay-period.actions";
import { PAY_PERIOD_STATUS_LABEL } from "@/lib/state-machines/labels";
import { format } from "date-fns";

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  READY: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  LOCKED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

export default async function PayPeriodsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "PAY_PERIOD_MANAGE")) redirect("/dashboard");

  const result = await getPayPeriods();
  if (!result.success) redirect("/dashboard");

  const payPeriods = result.data;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Pay Periods
        </h1>
        <Link
          href="/payroll/timecards"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          View Timecards
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {payPeriods.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">
            No pay periods found.
          </p>
        )}
        {payPeriods.map((pp) => {
          const total = pp.timesheets.length;
          const approved = pp.timesheets.filter(
            (t) => t.status === "PAYROLL_APPROVED" || t.status === "LOCKED"
          ).length;

          return (
            <Link
              key={pp.id}
              href={`/payroll/pay-periods/${pp.id}`}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-white">
                  {format(pp.startDate, "MMM d")} –{" "}
                  {format(pp.endDate, "MMM d, yyyy")}
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {approved}/{total} timesheets approved
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[pp.status]}`}
              >
                {PAY_PERIOD_STATUS_LABEL[pp.status]}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
