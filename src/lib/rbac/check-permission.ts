import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission, type Permission } from "./permissions";
import { hasPermissionByLegacy } from "./permission-resolver";
import { VIEW_AS_ROLE_COOKIE } from "@/lib/constants";

const PRIVILEGED_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

// Legacy role strings — used to detect old-format view-as cookies
const LEGACY_ROLE_STRINGS = new Set([
  "EMPLOYEE", "SUPERVISOR", "PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN",
]);

// Rank → legacy role approximation for getEffectiveRole compat
const RANK_TO_ROLE: [number, string][] = [
  [4, "SYSTEM_ADMIN"],
  [3, "HR_ADMIN"],
  [2, "PAYROLL_ADMIN"],
  [1, "SUPERVISOR"],
  [0, "EMPLOYEE"],
];

async function resolveViewAsId(realRole: string, canViewAs: boolean): Promise<string | null> {
  const eligible = PRIVILEGED_ROLES.includes(realRole) || canViewAs;
  if (!eligible) return null;
  try {
    const cookieStore = await cookies();
    return cookieStore.get(VIEW_AS_ROLE_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the role that should be used for UI permission checks.
 * When view-as is active, returns the impersonated role's legacy enum string.
 * For CustomRole ID cookies, maps rank to a legacy role string.
 */
export async function getEffectiveRole(user: {
  role: string;
  canViewAs?: boolean;
}): Promise<string> {
  const viewAsId = await resolveViewAsId(user.role ?? "EMPLOYEE", user.canViewAs ?? false);
  if (!viewAsId) return user.role ?? "EMPLOYEE";

  // Old cookie format (legacy enum string) — return as-is for backward compat
  if (LEGACY_ROLE_STRINGS.has(viewAsId)) return viewAsId;

  // New format: CustomRole ID — map rank to legacy role string
  try {
    const cr = await db.customRole.findUnique({ where: { id: viewAsId }, select: { rank: true } });
    if (!cr) return user.role ?? "EMPLOYEE";
    for (const [minRank, legacyRole] of RANK_TO_ROLE) {
      if (cr.rank >= minRank) return legacyRole;
    }
  } catch {
    // ignore
  }
  return "EMPLOYEE";
}

/**
 * Server-side permission check for server actions — always uses REAL role, never view-as.
 */
export async function requirePermission(permission: Permission): Promise<{
  employeeId: string;
  role: string;
}> {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  if (session.user.role === "SUPER_ADMIN" || session.user.role === "SYSTEM_ADMIN") {
    return {
      employeeId: session.user.employeeId ?? "",
      role: session.user.role,
    };
  }

  const customRoleId = session.user.customRoleId ?? null;
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

async function checkViewAsPermission(viewAsId: string, permission: Permission): Promise<boolean> {
  // Old cookie format — use static map
  if (LEGACY_ROLE_STRINGS.has(viewAsId)) return hasPermission(viewAsId, permission);
  // New format — use real DB permissions
  return hasPermissionByLegacy(viewAsId, permission);
}

/**
 * Returns true/false — use in Server Components to conditionally render UI.
 * Respects the view-as cookie so admins and canViewAs users see the simulated role's permissions.
 */
export async function checkPermission(permission: Permission): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  const realRole = session.user.role ?? "EMPLOYEE";
  const canViewAs = session.user.canViewAs ?? false;
  const viewAsId = await resolveViewAsId(realRole, canViewAs);

  if (viewAsId) return checkViewAsPermission(viewAsId, permission);

  if (realRole === "SUPER_ADMIN" || realRole === "SYSTEM_ADMIN") return true;
  const customRoleId = session.user.customRoleId ?? null;
  if (customRoleId) return hasPermissionByLegacy(customRoleId, permission);
  return hasPermission(realRole, permission);
}

/**
 * Check permission against an already-loaded session user.
 * Use in page components that already called auth() — avoids a second auth() call.
 * Respects the view-as cookie.
 */
export async function userHasPermission(
  user: { role: string; customRoleId?: string | null; canViewAs?: boolean },
  permission: Permission
): Promise<boolean> {
  const realRole = user.role ?? "EMPLOYEE";
  const canViewAs = user.canViewAs ?? false;
  const viewAsId = await resolveViewAsId(realRole, canViewAs);

  if (viewAsId) return checkViewAsPermission(viewAsId, permission);

  if (realRole === "SUPER_ADMIN" || realRole === "SYSTEM_ADMIN") return true;
  const customRoleId = user.customRoleId ?? null;
  if (customRoleId) return hasPermissionByLegacy(customRoleId, permission);
  return hasPermission(realRole, permission);
}
