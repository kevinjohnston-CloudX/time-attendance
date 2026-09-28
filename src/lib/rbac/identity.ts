import { db } from "@/lib/db";
import { ROLE_RANK, isValidRole, type Role } from "./roles";

/**
 * Who a signed-in person is right now, read from the database rather than
 * from their sign-in token.
 *
 * <p>The token is written once at sign in and a session lasts hours, so a
 * role, company or active flag taken from it goes stale: somebody demoted,
 * moved or deactivated kept their old powers until they signed out. The
 * sign-in callback refreshes the token from this on every request (see
 * auth.ts), so every check that reads the session reads the live answer.
 *
 * <p>Cached for a few seconds per server instance, because one page asks for
 * the session several times. Call {@link forgetIdentity} after changing
 * somebody's role or status so it takes effect at once here.
 */

export interface LiveIdentity {
  userId: string;
  isSuperAdmin: boolean;
  employeeId: string | null;
  tenantId: string | null;
  role: Role;
  customRoleId: string | null;
  /** How senior they are: the custom role's rank, or the built-in role's. */
  rank: number;
  canViewAs: boolean;
  /** An employee record marked active, as the rest of the app reads it. True for a super admin. */
  isActive: boolean;
  mustChangePassword: boolean;
}

const TTL_MS = 10_000;
const cache = new Map<string, { at: number; value: LiveIdentity | null }>();

export async function liveIdentity(userId: string): Promise<LiveIdentity | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isSuperAdmin: true,
      mustChangePassword: true,
      employee: {
        select: {
          id: true,
          tenantId: true,
          role: true,
          customRoleId: true,
          isActive: true,
          customRole: { select: { rank: true, canViewAs: true, tenantId: true, isActive: true } },
        },
      },
    },
  });

  let value: LiveIdentity | null = null;
  if (user?.isSuperAdmin) {
    value = {
      userId: user.id,
      isSuperAdmin: true,
      employeeId: null,
      tenantId: null,
      role: "SUPER_ADMIN",
      customRoleId: null,
      rank: ROLE_RANK.SUPER_ADMIN,
      canViewAs: false,
      isActive: true,
      mustChangePassword: false,
    };
  } else if (user) {
    const e = user.employee;
    const role: Role = e && isValidRole(e.role) ? e.role : "EMPLOYEE";
    // A custom role only counts inside its own company and while it is on.
    const custom = e?.customRole && e.customRole.tenantId === e.tenantId && e.customRole.isActive ? e.customRole : null;
    value = {
      userId: user.id,
      isSuperAdmin: false,
      employeeId: e?.id ?? null,
      tenantId: e?.tenantId ?? null,
      // Nobody but a real super admin is ever SUPER_ADMIN.
      role: role === "SUPER_ADMIN" ? "EMPLOYEE" : role,
      customRoleId: custom ? e!.customRoleId : null,
      rank: custom ? custom.rank : ROLE_RANK[role === "SUPER_ADMIN" ? "EMPLOYEE" : role],
      canViewAs: custom?.canViewAs ?? false,
      isActive: !!e && e.isActive,
      mustChangePassword: user.mustChangePassword,
    };
  }
  cache.set(userId, { at: Date.now(), value });
  return value;
}

/** Drops the cached answer for a person, after their role or status changed. */
export function forgetIdentity(userId: string | null | undefined): void {
  if (userId) cache.delete(userId);
}

/**
 * How senior an employee is, for "you can only manage people below you":
 * their custom role's rank inside their own company, or their built-in role's.
 */
export async function employeeRank(employeeId: string, tenantId: string): Promise<number | null> {
  const e = await db.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { role: true, user: { select: { isSuperAdmin: true } }, customRole: { select: { rank: true, tenantId: true } } },
  });
  if (!e) return null;
  if (e.user?.isSuperAdmin) return ROLE_RANK.SUPER_ADMIN;
  if (e.customRole && e.customRole.tenantId === tenantId) return e.customRole.rank;
  return isValidRole(e.role) ? ROLE_RANK[e.role] : 0;
}

/** Permissions an inactive employee keeps: their own documents, balances and last timesheet. */
export const INACTIVE_PERMISSIONS = ["DOCUMENT_VIEW_OWN", "ACCRUAL_VIEW_OWN", "TIMESHEET_SUBMIT_OWN"] as const;

/** Pages an inactive employee keeps, matching the restricted menu. */
export const INACTIVE_PATHS = ["/time/timesheet", "/time/history", "/documents"];
