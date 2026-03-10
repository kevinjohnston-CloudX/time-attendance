import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "./permissions";
import { hasPermissionByLegacy } from "./permission-resolver";

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

  // SUPER_ADMIN bypass
  if (session.user.role === "SUPER_ADMIN") {
    return {
      employeeId: session.user.employeeId ?? "",
      role: session.user.role,
    };
  }

  // Try custom role first, fall back to legacy enum
  const customRoleId = session.user.customRoleId;
  let allowed = false;

  if (customRoleId) {
    allowed = await hasPermissionByLegacy(customRoleId, permission);
  } else {
    allowed = hasPermission(session.user.role, permission);
  }

  if (!allowed) {
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

  const customRoleId = session.user.customRoleId;
  if (customRoleId) {
    return hasPermissionByLegacy(customRoleId, permission);
  }
  return hasPermission(session.user.role, permission);
}
