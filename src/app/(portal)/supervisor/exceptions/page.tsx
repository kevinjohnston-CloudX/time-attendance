import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getTeamExceptions } from "@/actions/supervisor.actions";
import { ExceptionActionPanel } from "@/components/supervisor/exception-action-panel";
import { format } from "date-fns";

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH: "Missing Punch",
  LONG_SHIFT: "Long Shift",
  SHORT_BREAK: "Short Break",
  MISSED_MEAL: "Missed Meal",
  UNSCHEDULED_OT: "Unscheduled OT",
  CONSECUTIVE_DAYS: "Consecutive Days",
};

export default async function ExceptionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const result = await getTeamExceptions();
  if (!result.success) redirect("/supervisor");

  const exceptions = result.data;

  return (
    <div>
      <Link
        href="/supervisor"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Team Portal
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        Open Exceptions
      </h1>

      <div className="mt-6 flex flex-col gap-3">
        {exceptions.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">
            No open exceptions.
          </p>
        )}
        {exceptions.map((ex) => (
          <div
            key={ex.id}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-zinc-900 dark:text-white">
                  {ex.timesheet.employee.user?.name ?? `Employee ${ex.timesheet.employeeId}`}
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {EXCEPTION_LABEL[ex.exceptionType] ?? ex.exceptionType}
                  {" · "}
                  {format(ex.occurredAt, "MMM d, yyyy h:mm a")}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Pay period:{" "}
                  {format(ex.timesheet.payPeriod.startDate, "MMM d")} –{" "}
                  {format(ex.timesheet.payPeriod.endDate, "MMM d, yyyy")}
                </p>
                {ex.description && (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {ex.description}
                  </p>
                )}
              </div>
            </div>
            <ExceptionActionPanel
              exceptionId={ex.id}
              exceptionType={ex.exceptionType}
              timesheetId={ex.timesheetId}
              punches={ex.timesheet.punches}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
