import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "./permissions";
import { hasPermissionByLegacy } from "./permission-resolver";
import { VIEW_AS_ROLE_COOKIE } from "@/lib/constants";

const VIEWAS_ELIGIBLE = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

async function resolveViewAsRole(realRole: string): Promise<string | null> {
  if (!VIEWAS_ELIGIBLE.includes(realRole)) return null;
  try {
    const cookieStore = await cookies();
    return cookieStore.get(VIEW_AS_ROLE_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the role that should be used for UI permission checks.
 * For SYSTEM_ADMIN/SUPER_ADMIN this returns the view-as role when active,
 * otherwise returns the real session role.
 */
export async function getEffectiveRole(user: { role: string }): Promise<string> {
  const viewAs = await resolveViewAsRole(user.role ?? "EMPLOYEE");
  return viewAs ?? user.role ?? "EMPLOYEE";
}

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

  const customRoleId = session.user.role === "EMPLOYEE" ? (session.user.customRoleId ?? null) : null;
  const allowed = customRoleId
    ? await hasPermissionByLegacy(customRoleId, permission)
    : hasPermission(session.user.role, permission);
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
 * Respects the view-as cookie so SYSTEM_ADMIN/SUPER_ADMIN see the same page
 * restrictions as the role they are impersonating.
 */
export async function checkPermission(permission: Permission): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  const realRole = session.user.role ?? "EMPLOYEE";
  const viewAs = await resolveViewAsRole(realRole);
  const effectiveRole = viewAs ?? realRole;
  if (effectiveRole === "SUPER_ADMIN") return true;
  const customRoleId = effectiveRole === "EMPLOYEE" ? (session.user.customRoleId ?? null) : null;
  if (customRoleId) return hasPermissionByLegacy(customRoleId, permission);
  return hasPermission(effectiveRole, permission);
}

/**
 * Check permission against an already-loaded session user.
 * Use in page components that already called auth() — avoids a second auth() call.
 * Respects the view-as cookie for SYSTEM_ADMIN/SUPER_ADMIN.
 */
export async function userHasPermission(
  user: { role: string; customRoleId?: string | null },
  permission: Permission
): Promise<boolean> {
  const realRole = user.role ?? "EMPLOYEE";
  const viewAs = await resolveViewAsRole(realRole);
  const effectiveRole = viewAs ?? realRole;
  if (effectiveRole === "SUPER_ADMIN") return true;
  const customRoleId = effectiveRole === "EMPLOYEE" ? (user.customRoleId ?? null) : null;
  if (customRoleId) return hasPermissionByLegacy(customRoleId, permission);
  return hasPermission(effectiveRole, permission);
}
