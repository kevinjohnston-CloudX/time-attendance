import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/timesheet-state";
import { formatMinutes } from "@/lib/utils/duration";
import { format } from "date-fns";

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  SUBMITTED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  SUP_APPROVED: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  PAYROLL_APPROVED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  LOCKED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

export default async function TimesheetListPage() {
  const session = await auth();
  if (!session?.user?.employeeId) redirect("/dashboard");

  const timesheets = await db.timesheet.findMany({
    where: { employeeId: session.user.employeeId },
    include: {
      payPeriod: true,
      overtimeBuckets: true,
    },
    orderBy: { payPeriod: { startDate: "desc" } },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
        My Timesheets
      </h1>

      <div className="mt-6 flex flex-col gap-3">
        {timesheets.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">
            No timesheets yet. Timesheets are created automatically when you
            punch in.
          </p>
        )}
        {timesheets.map((ts) => {
          const regBucket = ts.overtimeBuckets.find((b) => b.bucket === "REG");
          const regMinutes = regBucket?.totalMinutes ?? 0;
          return (
            <Link
              key={ts.id}
              href={`/time/timesheet/${ts.id}`}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-white">
                  {format(ts.payPeriod.startDate, "MMM d")} –{" "}
                  {format(ts.payPeriod.endDate, "MMM d, yyyy")}
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {formatMinutes(regMinutes)} regular
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[ts.status]}`}
              >
                {TIMESHEET_STATUS_LABEL[ts.status]}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
