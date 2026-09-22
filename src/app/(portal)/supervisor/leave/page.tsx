import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamLeaveRequests, getUpcomingTeamLeave, getHrPendingLeave } from "@/actions/supervisor.actions";
import { LeaveTabs } from "@/components/supervisor/leave-tabs";

/**
 * Team Leave — the list screen, as the portal design lays it out.
 *
 * <p>Three queues, not one list: what is waiting on this supervisor, what has
 * gone up to HR, and what is already approved and still to come. They are
 * separate queries because they are separately permission-scoped — a
 * supervisor sees their own reports, payroll sees the site — so the tabs in
 * {@link LeaveTabs} switch between rows already fetched rather than re-running
 * anything. A tab that re-queried would quietly change whose leave you are
 * looking at.
 *
 * <p>`siteId` and `departmentId` are read from the query string and passed
 * into every one of the three, so a filtered view survives a reload and can be
 * sent to somebody. The department list is scoped to the chosen site for the
 * same reason the filter chips clear together.
 */
export default async function SupervisorLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; siteId?: string; departmentId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "LEAVE_APPROVE_TEAM")) redirect("/dashboard");

  const { tab, siteId, departmentId } = (await searchParams) ?? {};
  const initialTab = tab === "upcoming" ? "upcoming" : tab === "hr-pending" ? "hr-pending" : "pending";

  const canFilter = await userHasPermission(session.user, "LEAVE_APPROVE_ANY");
  const canHrApprove = canFilter;
  const canSubmitLeave = await userHasPermission(session.user, "LEAVE_REQUEST_TEAM");
  const tenantId = (session.user as { tenantId?: string }).tenantId;
  const filterInput = canFilter ? { siteId, departmentId } : {};

  const [pendingResult, hrPendingResult, upcomingResult, sites, departments] = await Promise.all([
    getTeamLeaveRequests(filterInput),
    getHrPendingLeave(filterInput),
    getUpcomingTeamLeave(filterInput),
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
  if (!hrPendingResult.success) redirect("/supervisor");
  if (!upcomingResult.success) redirect("/supervisor");

  return (
    <LeaveTabs
      pending={pendingResult.data}
      hrPending={hrPendingResult.data}
      upcoming={upcomingResult.data}
      initialTab={initialTab}
      canFilter={canFilter}
      canHrApprove={canHrApprove}
      canSubmitLeave={canSubmitLeave}
      sites={sites}
      departments={departments}
      selectedSiteId={siteId}
      selectedDepartmentId={departmentId}
    />
  );
}
