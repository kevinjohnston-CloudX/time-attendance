import { db } from "@/lib/db";
import { hasPermissionByLegacy } from "@/lib/rbac/permission-resolver";

/**
 * Everyone in a company who gives the HR approval on time off: active people
 * whose role carries LEAVE_APPROVE_ANY. The same people the Approvals screen
 * shows "Leave awaiting HR approval" to, so a notification never reaches
 * someone who cannot act on it.
 *
 * <p>One permission check per role, not per person: a company has a handful
 * of roles.
 */
export async function hrApprovers(tenantId: string, exceptEmployeeIds: (string | null)[] = []): Promise<{ employeeId: string; userId: string }[]> {
  const candidates = await db.employee.findMany({
    where: {
      tenantId,
      isActive: true,
      customRoleId: { not: null },
      NOT: { id: { in: exceptEmployeeIds.filter((id): id is string => !!id) } },
    },
    select: { id: true, userId: true, customRoleId: true },
  });
  const roles = [...new Set(candidates.map((c) => c.customRoleId!))];
  const approving = new Set<string>();
  for (const role of roles) if (await hasPermissionByLegacy(role, "LEAVE_APPROVE_ANY")) approving.add(role);
  return candidates.filter((c) => approving.has(c.customRoleId!) && c.userId).map((c) => ({ employeeId: c.id, userId: c.userId }));
}
