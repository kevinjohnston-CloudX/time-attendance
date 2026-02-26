import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getMyLeaveRequests, getMyLeaveBalances } from "@/actions/leave.actions";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_BADGE,
} from "@/lib/state-machines/leave-state";
import { formatMinutes } from "@/lib/utils/duration";
import { format } from "date-fns";
import { Plus } from "lucide-react";

export default async function MyLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "LEAVE_REQUEST_OWN")) redirect("/dashboard");

  const [requestsResult, balancesResult] = await Promise.all([
    getMyLeaveRequests(),
    getMyLeaveBalances(),
  ]);

  if (!requestsResult.success || !balancesResult.success) redirect("/dashboard");

  const requests = requestsResult.data;
  const balances = balancesResult.data;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
          My Leave
        </h1>
        <Link
          href="/leave/request"
          className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Plus className="h-4 w-4" />
          Request Leave
        </Link>
      </div>

      {/* Balances */}
      {balances.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
            Current Balances
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {balances.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="text-xs text-zinc-500">{b.leaveType.name}</p>
                <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">
                  {formatMinutes(b.balanceMinutes)}
                </p>
                <p className="text-xs text-zinc-400">
                  Used: {formatMinutes(b.usedMinutes)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request list */}
      <div className="mt-6 flex flex-col gap-3">
        {requests.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">
            No leave requests yet.
          </p>
        )}
        {requests.map((req) => (
          <div
            key={req.id}
            className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div>
              <p className="font-medium text-zinc-900 dark:text-white">
                {req.leaveType.name}
              </p>
              <p className="mt-0.5 text-sm text-zinc-500">
                {format(req.startDate, "MMM d")} –{" "}
                {format(req.endDate, "MMM d, yyyy")} ·{" "}
                {formatMinutes(req.durationMinutes)}
              </p>
              {req.reviewNote && (
                <p className="mt-0.5 text-xs text-zinc-400">
                  Note: {req.reviewNote}
                </p>
              )}
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${LEAVE_STATUS_BADGE[req.status]}`}
            >
              {LEAVE_STATUS_LABEL[req.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
