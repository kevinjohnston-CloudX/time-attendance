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
  return hasPermission(session.user.role, permission);
}
