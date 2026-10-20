import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { loadTeamMembers, type TeamMembersParams } from "@/lib/team-members/team-members-data";
import { TeamMembersScreen } from "@/components/supervisor/team-members-screen";

/**
 * Team Members: the people this viewer may see, read only (View team
 * employees). Who is listed is decided in the loader.
 */
export default async function TeamMembersPage({ searchParams }: { searchParams: Promise<TeamMembersParams> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [canView, canManage] = await Promise.all([
    userHasPermission(session.user, "EMPLOYEE_VIEW_TEAM"),
    userHasPermission(session.user, "EMPLOYEE_MANAGE"),
  ]);
  if (!canView && !canManage) redirect("/dashboard");

  const [data, ...timecardRights] = await Promise.all([
    loadTeamMembers(session.user as { employeeId?: string | null; tenantId?: string | null; role: string }, await searchParams),
    userHasPermission(session.user, "TIMECARD_VIEW_TEAM"),
    userHasPermission(session.user, "TIMECARD_VIEW_ANY"),
    userHasPermission(session.user, "TIMECARD_EDIT_TEAM"),
    userHasPermission(session.user, "TIMECARD_EDIT_ANY"),
  ]);
  return <TeamMembersScreen data={data} canViewTimecards={timecardRights.some(Boolean)} />;
}
