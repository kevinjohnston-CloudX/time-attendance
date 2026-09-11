import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { hasPermission, type Permission } from "./permissions";
import { hasPermissionByLegacy } from "./permission-resolver";
import { getEffectiveRole } from "./check-permission";
import type { Role } from "./roles";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Wraps a Server Action with RBAC enforcement.
 * When the employee has a customRoleId, permissions are resolved from the DB.
 * Otherwise falls back to the static role-permission map.
 */
export function withRBAC<TInput, TOutput>(
  permission: Permission | Permission[],
  handler: (
    ctx: { employeeId: string; role: Role; tenantId: string | null },
    input: TInput
  ) => Promise<TOutput>
) {
  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    const session = await auth();

    if (!session?.user) {
      return { success: false, error: "UNAUTHENTICATED" };
    }

    const realRole = session.user.role ?? "EMPLOYEE";
    const effectiveRole = await getEffectiveRole(session.user);
    const isPrivilegedAdmin = ["SUPER_ADMIN", "SYSTEM_ADMIN"].includes(realRole);

    if (!isPrivilegedAdmin) {
      const customRoleId = (session.user as { customRoleId?: string | null }).customRoleId ?? null;
      const perms = Array.isArray(permission) ? permission : [permission];
      const allowed = customRoleId
        ? await Promise.all(perms.map((p) => hasPermissionByLegacy(customRoleId, p))).then((r) => r.some(Boolean))
        : perms.some((p) => hasPermission(effectiveRole, p));
      if (!allowed) return { success: false, error: "FORBIDDEN" };
    }

    try {
      let tenantId = session.user.tenantId ?? null;
      if (["SYSTEM_ADMIN", "SUPER_ADMIN"].includes(realRole)) {
        const cookieStore = await cookies();
        const override = cookieStore.get(SUPER_ADMIN_TENANT_COOKIE)?.value;
        if (override) tenantId = override;
      }

      const data = await handler(
        {
          employeeId: session.user.employeeId ?? "",
          role: effectiveRole as Role,
          tenantId,
        },
        input
      );
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "INTERNAL_ERROR";
      return { success: false, error: message };
    }
  };
}
