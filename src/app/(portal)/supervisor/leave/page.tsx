import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamLeaveRequests, getUpcomingTeamLeave } from "@/actions/supervisor.actions";
import { LeaveTabs } from "@/components/supervisor/leave-tabs";

export default async function SupervisorLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; siteId?: string; departmentId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "LEAVE_APPROVE_TEAM")) redirect("/dashboard");

  const { tab, siteId, departmentId } = (await searchParams) ?? {};
  const initialTab = tab === "upcoming" ? "upcoming" : "pending";

  const canFilter = await userHasPermission(session.user, "LEAVE_APPROVE_ANY");
  const tenantId = (session.user as { tenantId?: string }).tenantId;

  const [pendingResult, upcomingResult, sites, departments] = await Promise.all([
    getTeamLeaveRequests(canFilter ? { siteId, departmentId } : {}),
    getUpcomingTeamLeave(canFilter ? { siteId, departmentId } : {}),
    canFilter && tenantId
      ? db.site.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : [],
    canFilter && tenantId
      ? db.department.findMany({
          where: { tenantId, isActive: true, ...(siteId ? { sites: { some: { siteId } } } : {}) },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
  ]);

  if (!pendingResult.success) redirect("/supervisor");
  if (!upcomingResult.success) redirect("/supervisor");

  return (
    <LeaveTabs
      pending={pendingResult.data}
      upcoming={upcomingResult.data}
      initialTab={initialTab}
      canFilter={canFilter}
      sites={sites}
      departments={departments}
      selectedSiteId={siteId}
      selectedDepartmentId={departmentId}
    />
  );
}
