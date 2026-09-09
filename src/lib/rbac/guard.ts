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
 * Permissions are always derived from the employee's enum role.
 *
 * @example
 * export const myAction = withRBAC("PUNCH_EDIT_ANY", async ({ employeeId, role, tenantId }, input) => {
 *   // ...
 * });
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
    const isSuperAdmin = effectiveRole === "SUPER_ADMIN";

    if (!isSuperAdmin) {
      const rawCustomRoleId = (session.user as { customRoleId?: string | null }).customRoleId ?? null;
      const customRoleId = effectiveRole === "EMPLOYEE" ? rawCustomRoleId : null;
      const perms = Array.isArray(permission) ? permission : [permission];
      const allowed = perms.some((p) =>
        customRoleId
          ? false // legacy roles checked separately below
          : hasPermission(effectiveRole, p)
      ) || (customRoleId ? await Promise.all(perms.map((p) => hasPermissionByLegacy(customRoleId, p))).then((r) => r.some(Boolean)) : false);
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
