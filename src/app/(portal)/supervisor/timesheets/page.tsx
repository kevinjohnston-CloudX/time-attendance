import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getTeamTimesheets } from "@/actions/supervisor.actions";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/timesheet-state";
import { ApproveTimesheetButtons } from "@/components/supervisor/approve-timesheet-buttons";
import { formatMinutes } from "@/lib/utils/duration";
import { format } from "date-fns";

export default async function TeamTimesheetsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const isPayroll = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"].includes(
    session.user.role
  );

  const result = await getTeamTimesheets();
  if (!result.success) redirect("/supervisor");

  const timesheets = result.data;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/supervisor"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          >
            ← Team Portal
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
            {isPayroll ? "Awaiting Payroll Approval" : "Awaiting Approval"}
          </h1>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {timesheets.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">
            No timesheets pending review.
          </p>
        )}
        {timesheets.map((ts) => {
          const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
          const ot = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
          const dt = ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;

          return (
            <div
              key={ts.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-white">
                    {ts.employee.user?.name ?? `Employee ${ts.employeeId}`}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {format(ts.payPeriod.startDate, "MMM d")} –{" "}
                    {format(ts.payPeriod.endDate, "MMM d, yyyy")}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    REG {formatMinutes(reg)}
                    {ot > 0 && (
                      <span className="ml-2 text-amber-600">
                        OT {formatMinutes(ot)}
                      </span>
                    )}
                    {dt > 0 && (
                      <span className="ml-2 text-red-600">
                        DT {formatMinutes(dt)}
                      </span>
                    )}
                    {ts.exceptions.length > 0 && (
                      <span className="ml-2 text-red-500">
                        {ts.exceptions.length} exception(s)
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400">
                    {TIMESHEET_STATUS_LABEL[ts.status]}
                  </span>
                  <ApproveTimesheetButtons
                    timesheetId={ts.id}
                    status={ts.status}
                    isPayroll={isPayroll}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
