import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "./permissions";
import type { Role } from "./roles";

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Wraps a Server Action with RBAC enforcement.
 *
 * @example
 * export const myAction = withRBAC("PUNCH_EDIT_ANY", async ({ employeeId, role }, input) => {
 *   // ...
 * });
 */
export function withRBAC<TInput, TOutput>(
  permission: Permission,
  handler: (
    ctx: { employeeId: string; role: Role },
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
      const data = await handler(
        {
          employeeId: session.user.employeeId ?? "",
          role: session.user.role as Role,
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
