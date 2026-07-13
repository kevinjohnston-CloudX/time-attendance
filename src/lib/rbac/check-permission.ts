import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "./permissions";

/**
 * Server-side permission check. Call from Server Components or Server Actions.
 * Throws if the session is missing or the user lacks the required permission.
 */
export async function requirePermission(permission: Permission): Promise<{
  employeeId: string;
  role: string;
}> {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  if (session.user.role === "SUPER_ADMIN") {
    return {
      employeeId: session.user.employeeId ?? "",
      role: session.user.role,
    };
  }

  if (!hasPermission(session.user.role, permission)) {
    throw new Error("FORBIDDEN");
  }

  return {
    employeeId: session.user.employeeId ?? "",
    role: session.user.role,
  };
}

/**
 * Returns true/false — use in Server Components to conditionally render UI.
 */
export async function checkPermission(permission: Permission): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  if (session.user.role === "SUPER_ADMIN") return true;
  return hasPermission(session.user.role, permission);
}

/**
 * Check permission against an already-loaded session user.
 * Use in page components that already called auth() — avoids a second auth() call.
 */
export async function userHasPermission(
  user: { role: string; customRoleId?: string | null },
  permission: Permission
): Promise<boolean> {
  if (user.role === "SUPER_ADMIN") return true;
  return hasPermission(user.role, permission);
}
