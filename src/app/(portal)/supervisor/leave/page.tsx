import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getTeamLeaveRequests } from "@/actions/supervisor.actions";
import { LeaveApprovalButtons } from "@/components/supervisor/leave-approval-buttons";
import { format, differenceInCalendarDays } from "date-fns";

export default async function SupervisorLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "LEAVE_APPROVE_TEAM")) redirect("/dashboard");

  const result = await getTeamLeaveRequests();
  if (!result.success) redirect("/supervisor");

  const requests = result.data;

  return (
    <div>
      <Link
        href="/supervisor"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Team Portal
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        Pending Leave Requests
      </h1>

      <div className="mt-6 flex flex-col gap-3">
        {requests.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">
            No pending leave requests.
          </p>
        )}
        {requests.map((req) => {
          const days =
            differenceInCalendarDays(req.endDate, req.startDate) + 1;

          return (
            <div
              key={req.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-white">
                    {req.employee.user?.name ?? `Employee ${req.employeeId}`}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    {req.leaveType.name} ·{" "}
                    {format(req.startDate, "MMM d")} –{" "}
                    {format(req.endDate, "MMM d, yyyy")} ({days} day
                    {days !== 1 ? "s" : ""})
                  </p>
                  {req.note && (
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      "{req.note}"
                    </p>
                  )}
                </div>
                <LeaveApprovalButtons leaveRequestId={req.id} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
