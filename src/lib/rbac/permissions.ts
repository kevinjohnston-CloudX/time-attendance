import type { Role } from "./roles";

export const PERMISSIONS = [
  // Punch
  "PUNCH_OWN",
  "PUNCH_VIEW_TEAM",
  "PUNCH_EDIT_TEAM",
  "PUNCH_EDIT_ANY",
  // Timesheet
  "TIMESHEET_SUBMIT_OWN",
  "TIMESHEET_APPROVE_TEAM",
  "TIMESHEET_APPROVE_ANY",
  // Leave
  "LEAVE_REQUEST_OWN",
  "LEAVE_APPROVE_TEAM",
  "LEAVE_APPROVE_ANY",
  // Payroll & admin
  "PAY_PERIOD_MANAGE",
  "EMPLOYEE_MANAGE",
  "RULES_MANAGE",
  "AUDIT_VIEW",
  "SITE_MANAGE",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const rolePermissions: Record<Role, Permission[]> = {
  EMPLOYEE: ["PUNCH_OWN", "TIMESHEET_SUBMIT_OWN", "LEAVE_REQUEST_OWN"],
  SUPERVISOR: [
    "PUNCH_OWN",
    "PUNCH_VIEW_TEAM",
    "PUNCH_EDIT_TEAM",
    "TIMESHEET_SUBMIT_OWN",
    "TIMESHEET_APPROVE_TEAM",
    "LEAVE_REQUEST_OWN",
    "LEAVE_APPROVE_TEAM",
  ],
  PAYROLL_ADMIN: [
    "PUNCH_OWN",
    "PUNCH_VIEW_TEAM",
    "PUNCH_EDIT_TEAM",
    "PUNCH_EDIT_ANY",
    "TIMESHEET_SUBMIT_OWN",
    "TIMESHEET_APPROVE_TEAM",
    "TIMESHEET_APPROVE_ANY",
    "LEAVE_REQUEST_OWN",
    "LEAVE_APPROVE_TEAM",
    "LEAVE_APPROVE_ANY",
    "PAY_PERIOD_MANAGE",
    "AUDIT_VIEW",
  ],
  HR_ADMIN: [
    "PUNCH_OWN",
    "PUNCH_VIEW_TEAM",
    "PUNCH_EDIT_TEAM",
    "PUNCH_EDIT_ANY",
    "TIMESHEET_SUBMIT_OWN",
    "TIMESHEET_APPROVE_TEAM",
    "TIMESHEET_APPROVE_ANY",
    "LEAVE_REQUEST_OWN",
    "LEAVE_APPROVE_TEAM",
    "LEAVE_APPROVE_ANY",
    "PAY_PERIOD_MANAGE",
    "EMPLOYEE_MANAGE",
    "RULES_MANAGE",
    "AUDIT_VIEW",
    "SITE_MANAGE",
  ],
  SYSTEM_ADMIN: [...PERMISSIONS],
};

export function getPermissions(role: Role): Permission[] {
  return rolePermissions[role] ?? [];
}

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = rolePermissions[role as Role];
  if (!perms) return false;
  return perms.includes(permission);
}
