export const ROLES = [
  "EMPLOYEE",
  "SUPERVISOR",
  "PAYROLL_ADMIN",
  "HR_ADMIN",
  "SYSTEM_ADMIN",
] as const;

export type Role = (typeof ROLES)[number];

/** Numeric rank — higher = more privileged. Used for hierarchy checks. */
export const ROLE_RANK: Record<Role, number> = {
  EMPLOYEE: 0,
  SUPERVISOR: 1,
  PAYROLL_ADMIN: 2,
  HR_ADMIN: 3,
  SYSTEM_ADMIN: 4,
};

export function isValidRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

export function hasMinRole(userRole: string, minRole: Role): boolean {
  if (!isValidRole(userRole)) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}
