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

export function hasMinRole(userRole: string, minRole: Role): boolean {
  if (!isValidRole(userRole)) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}
