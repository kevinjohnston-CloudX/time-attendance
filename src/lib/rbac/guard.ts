import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { hasPermission, type Permission } from "./permissions";
import type { Role } from "./roles";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Wraps a Server Action with RBAC enforcement.
 *
 * @example
 * export const myAction = withRBAC("PUNCH_EDIT_ANY", async ({ employeeId, role, tenantId }, input) => {
 *   // ...
 * });
 */
export function withRBAC<TInput, TOutput>(
  permission: Permission,
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

    if (!hasPermission(session.user.role, permission)) {
      return { success: false, error: "FORBIDDEN" };
    }

    try {
      let tenantId = session.user.tenantId ?? null;
      if (session.user.role === "SUPER_ADMIN") {
        const cookieStore = await cookies();
        const override = cookieStore.get(SUPER_ADMIN_TENANT_COOKIE)?.value;
        if (override) tenantId = override;
      }

      const data = await handler(
        {
          employeeId: session.user.employeeId ?? "",
          role: session.user.role as Role,
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
