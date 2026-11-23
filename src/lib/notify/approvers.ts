import { db } from "@/lib/db";
import { hasPermissionByLegacy } from "@/lib/rbac/permission-resolver";

export type HrApprover = {
  employeeId: string;
  userId: string;
  /** The sites on their record (Site access), or null for every site. */
  sites: string[] | null;
};

/**
 * Everyone in a company who gives the HR approval on time off: active people
 * whose role carries LEAVE_APPROVE_ANY. The same people the Approvals screen
 * shows "Leave awaiting HR approval" to, so a notification never reaches
 * someone who cannot act on it. Each comes with the sites they are held to
 * (site-limit.ts): pass a request's site to {@link coversSite}, as the screen
 * shows them only their own sites' requests.
 *
 * <p>One permission check per role, not per person: a company has a handful
 * of roles.
 */
export async function hrApprovers(tenantId: string, exceptEmployeeIds: (string | null)[] = []): Promise<HrApprover[]> {
  const candidates = await db.employee.findMany({
    where: {
      tenantId,
      isActive: true,
      customRoleId: { not: null },
      NOT: { id: { in: exceptEmployeeIds.filter((id): id is string => !!id) } },
    },
    select: { id: true, userId: true, customRoleId: true, role: true, siteAccess: { select: { siteId: true } } },
  });
  const roles = [...new Set(candidates.map((c) => c.customRoleId!))];
  const approving = new Set<string>();
  for (const role of roles) if (await hasPermissionByLegacy(role, "LEAVE_APPROVE_ANY")) approving.add(role);
  return candidates
    .filter((c) => approving.has(c.customRoleId!) && c.userId)
    .map((c) => ({
      employeeId: c.id,
      userId: c.userId,
      // As siteLimit reads it: System and super admins are never held to sites.
      sites: c.role === "SYSTEM_ADMIN" || c.role === "SUPER_ADMIN" || c.siteAccess.length === 0 ? null : c.siteAccess.map((s) => s.siteId),
    }));
}

/** Whether the approver sees requests from someone at this site. */
export function coversSite(approver: HrApprover, siteId: string): boolean {
  return approver.sites === null || approver.sites.includes(siteId);
}
