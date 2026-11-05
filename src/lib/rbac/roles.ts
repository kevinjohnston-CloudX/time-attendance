export const ROLES = [
  "EMPLOYEE",
  "SUPERVISOR",
  "PAYROLL_ADMIN",
  "HR_ADMIN",
  "SYSTEM_ADMIN",
  "SUPER_ADMIN",
] as const;

export type Role = (typeof ROLES)[number];

/** Numeric rank — higher = more privileged. Used for hierarchy checks. */
export const ROLE_RANK: Record<Role, number> = {
  EMPLOYEE: 0,
  SUPERVISOR: 1,
  PAYROLL_ADMIN: 2,
  HR_ADMIN: 3,
  SYSTEM_ADMIN: 4,
  SUPER_ADMIN: 5,
};

/**
 * The highest rank a company's own role can carry: System Admin. A custom
 * role's rank is a number typed on the Roles page, and a rank above this one
 * outranked a super admin in every "only someone more senior" check, so a
 * System Admin could raise their own role and reset the super admin's login.
 * Every rank read from a role goes through {@link companyRank}.
 */
export const COMPANY_TOP_RANK = ROLE_RANK.SYSTEM_ADMIN;

/** A company role's rank as the checks read it: never above System Admin. */
export function companyRank(rank: number): number {
  return Math.min(Math.max(rank, 0), COMPANY_TOP_RANK);
}

export function isValidRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

/**
 * Whether this person may give someone a role limited to Live Attendance
 * (such as Loss Prevention): System Admins and super admins only. HR and
 * Payroll create most accounts, and a person on such a role loses their own
 * timesheet and punch clock, so the choice stays with the admins.
 */
export function givesLiveAttendanceRoles(me: { isSuperAdmin: boolean; rank: number }): boolean {
  return me.isSuperAdmin || me.rank >= ROLE_RANK.SYSTEM_ADMIN;
}

/**
 * Whether this person may give a role at this rank: one below their own, or,
 * for a System Admin, one at their own, so a System Admin can make another
 * without a super admin. HR Admin shares System Admin's rank here, but an HR
 * Admin still gives only roles below it.
 */
export function givesRank(me: { isSuperAdmin: boolean; rank: number; role: string }, rank: number): boolean {
  if (me.isSuperAdmin || rank < me.rank) return true;
  // The rank checked too: a System Admin viewing as a junior role gives only what it could.
  return rank === me.rank && me.role === "SYSTEM_ADMIN" && me.rank >= ROLE_RANK.SYSTEM_ADMIN;
}

/**
 * Whether someone at this rank may change a peer's record in full (email,
 * role, status, pay and password): HR Admins each other's, System Admins each
 * other's. Below them a peer's record takes someone more senior. Giving a role
 * at or above one's own stays refused either way (assertAssignable), but for
 * a System Admin giving System Admin (givesRank), and a System Admin's sign in
 * (emails, password) is only a System Admin's to change.
 */
export function editsPeers(rank: number): boolean {
  return rank === ROLE_RANK.HR_ADMIN || rank === ROLE_RANK.SYSTEM_ADMIN;
}

export function hasMinRole(userRole: string, minRole: Role): boolean {
  if (!isValidRole(userRole)) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}
