import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamLeaveRequests, getUpcomingTeamLeave } from "@/actions/supervisor.actions";
import { LeaveTabs } from "@/components/supervisor/leave-tabs";

export default async function SupervisorLeavePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "LEAVE_APPROVE_TEAM")) redirect("/dashboard");

  const [pendingResult, upcomingResult] = await Promise.all([
    getTeamLeaveRequests(),
    getUpcomingTeamLeave(),
  ]);

  if (!pendingResult.success) redirect("/supervisor");
  if (!upcomingResult.success) redirect("/supervisor");

  return (
    <LeaveTabs
      pending={pendingResult.data}
      upcoming={upcomingResult.data}
    />
  );
}
