import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getTeamLeaveRequests, getUpcomingTeamLeave } from "@/actions/supervisor.actions";
import { LeaveTabs } from "@/components/supervisor/leave-tabs";

export default async function SupervisorLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "LEAVE_APPROVE_TEAM")) redirect("/dashboard");

  const [pendingResult, upcomingResult] = await Promise.all([
    getTeamLeaveRequests(),
    getUpcomingTeamLeave(),
  ]);

  if (!pendingResult.success) redirect("/supervisor");
  if (!upcomingResult.success) redirect("/supervisor");

  return (
    <div>
      <Link
        href="/supervisor"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        &larr; Team Portal
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
        Team Leave
      </h1>

      <LeaveTabs
        pending={pendingResult.data}
        upcoming={upcomingResult.data}
      />
    </div>
  );
}
