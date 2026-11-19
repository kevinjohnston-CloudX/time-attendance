import type { ReactNode } from "react";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { siteLimit } from "@/lib/rbac/site-limit";
import { getTeamLeaveRequests, getUpcomingTeamLeave, getHrPendingLeave, getTeamHeadcount } from "@/actions/supervisor.actions";
import { LeaveTabs } from "@/components/supervisor/leave-tabs";

export type LeaveParams = { tab?: string; siteId?: string; departmentId?: string; shiftId?: string };

/**
 * Leave requests, as the Approvals page's first queue (11/11; it was Team
 * Leave, /supervisor/leave, which now sends here).
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
export async function LeaveSection({ user, params, heading }: { user: Session["user"]; params: LeaveParams; heading: ReactNode }) {
  const { tab, siteId, departmentId, shiftId } = params;
  const initialTab = tab === "upcoming" ? "upcoming" : tab === "hr-pending" ? "hr-pending" : "pending";

  const canFilter = await userHasPermission(user, "LEAVE_APPROVE_ANY");
  const canHrApprove = canFilter;
  const canSubmitLeave = await userHasPermission(user, "LEAVE_REQUEST_TEAM");
  const tenantId = (user as { tenantId?: string }).tenantId;
  const filterInput = canFilter ? { siteId, departmentId, shiftId } : {};

  const [pendingResult, hrPendingResult, upcomingResult, headcountResult, sites, departments, shifts] = await Promise.all([
    getTeamLeaveRequests(filterInput),
    getHrPendingLeave(filterInput),
    getUpcomingTeamLeave(filterInput),
    getTeamHeadcount(filterInput),
    // Only the sites on their record (Site access), when it names some.
    canFilter && tenantId
      ? siteLimit({ employeeId: user.employeeId ?? "", role: user.role }).then((held) =>
          db.site.findMany({
            where: { tenantId, isActive: true, ...(held ? { id: { in: held } } : {}) },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          }),
        )
      : [],
    canFilter && tenantId
      ? db.department.findMany({
          where: { tenantId, isActive: true, ...(siteId ? { sites: { some: { siteId } } } : {}) },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [],
    // Shifts are a tenant-level list, and only offered to the same people who
    // get the site and department filters.
    canFilter && tenantId
      ? db.shift.findMany({
          where: { tenantId },
          orderBy: [{ number: "asc" }, { name: "asc" }],
          select: { id: true, name: true },
        })
      : [],
  ]);

  return (
    <LeaveTabs
      heading={heading}
      viewerEmployeeId={user.employeeId ?? null}
      pending={pendingResult.success ? pendingResult.data : []}
      hrPending={hrPendingResult.success ? hrPendingResult.data : []}
      upcoming={upcomingResult.success ? upcomingResult.data : []}
      headcount={headcountResult.success ? headcountResult.data : { total: 0, byDepartment: [] }}
      initialTab={initialTab}
      canFilter={canFilter}
      canHrApprove={canHrApprove}
      canSubmitLeave={canSubmitLeave}
      sites={sites}
      departments={departments}
      shifts={shifts}
      selectedSiteId={siteId}
      selectedDepartmentId={departmentId}
      selectedShiftId={shiftId}
    />
  );
}

