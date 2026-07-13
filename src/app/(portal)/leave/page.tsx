import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getMyLeaveRequests, getMyLeaveBalances } from "@/actions/leave.actions";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_BADGE,
} from "@/lib/state-machines/labels";
import { formatMinutes } from "@/lib/utils/duration";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { LeaveCalendar } from "@/components/leave/leave-calendar";

export default async function MyLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "LEAVE_REQUEST_OWN")) redirect("/dashboard");

  const [requestsResult, balancesResult] = await Promise.all([
    getMyLeaveRequests(),
    getMyLeaveBalances(),
  ]);

  if (!requestsResult.success || !balancesResult.success) redirect("/dashboard");

  const requests = requestsResult.data;
  const balances = balancesResult.data;

  // Pre-compute approved/pending minutes per leave type
  const approvedByType: Record<string, number> = {};
  const pendingByType: Record<string, number> = {};
  for (const r of requests) {
    if (r.status === "APPROVED") {
      approvedByType[r.leaveTypeId] = (approvedByType[r.leaveTypeId] ?? 0) + r.durationMinutes;
    } else if (r.status === "PENDING") {
      pendingByType[r.leaveTypeId] = (pendingByType[r.leaveTypeId] ?? 0) + r.durationMinutes;
    }
  }

  // Serialize dates for client component
  const calendarRequests = requests.map((r) => ({
    id: r.id,
    status: r.status,
    startDate: r.startDate instanceof Date ? r.startDate.toISOString() : String(r.startDate),
    endDate:   r.endDate   instanceof Date ? r.endDate.toISOString()   : String(r.endDate),
    leaveType: { name: r.leaveType.name },
    durationMinutes: r.durationMinutes,
  }));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">My Leave</h1>
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
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Current Balances
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {balances.map((b) => {
              const totalMinutes     = b.balanceMinutes + b.usedMinutes;
              const approvedMinutes  = approvedByType[b.leaveTypeId] ?? 0;
              const pendingMinutes   = pendingByType[b.leaveTypeId] ?? 0;
              const remainingMinutes = Math.max(0, totalMinutes - b.usedMinutes - approvedMinutes);
              return (
                <div
                  key={b.id}
                  className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Remaining {b.leaveType.name}
                  </p>
                  <p className="mt-1 text-xl font-bold text-zinc-900 dark:text-white">
                    {formatMinutes(remainingMinutes)}
                  </p>
                  <div className="mt-2 flex flex-col gap-0.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    <p className="text-xs text-zinc-400">
                      Approved: <span className="font-medium text-zinc-600 dark:text-zinc-300">{formatMinutes(approvedMinutes)}</span>
                    </p>
                    {pendingMinutes > 0 && (
                      <p className="text-xs text-zinc-400">
                        Pending: <span className="font-medium text-amber-600 dark:text-amber-400">{formatMinutes(pendingMinutes)}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="mt-6 flex items-stretch gap-5">
        {/* Left — request list */}
        <div className="w-72 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Leave Requests
          </p>
          <div className="mt-2 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "520px" }}>
            {requests.length === 0 && (
              <p className="py-8 text-center text-sm text-zinc-400">
                No leave requests yet.
              </p>
            )}
            {requests.map((req) => (
              <div
                key={req.id}
                className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">
                    {req.leaveType.name}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${LEAVE_STATUS_BADGE[req.status]}`}
                  >
                    {LEAVE_STATUS_LABEL[req.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {format(req.startDate, "MMM d")} – {format(req.endDate, "MMM d, yyyy")}
                </p>
                <p className="text-xs text-zinc-400">{formatMinutes(req.durationMinutes)}</p>
                {req.reviewNote && (
                  <p className="mt-1 text-xs text-zinc-400 italic">{req.reviewNote}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right — calendar */}
        <div className="flex flex-1 flex-col">
          <LeaveCalendar requests={calendarRequests} className="flex-1" />
        </div>
      </div>
    </div>
  );
}
