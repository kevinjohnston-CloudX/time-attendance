import type { Role } from "./roles";

export const PERMISSIONS = [
  // Punch
  "PUNCH_OWN",
  "PUNCH_VIEW_TEAM",
  "PUNCH_EDIT_TEAM",
  "PUNCH_EDIT_ANY",
  // Fix a missed punch on your team's timecards and nothing else: add the
  // missing clock in or clock out on a day marked Missed punch, under the
  // person's regular hours pay code (lib/timecards/missed-punch-fix).
  "PUNCH_FIX_MISSED_TEAM",
  // Timesheet
  "TIMESHEET_SUBMIT_OWN",
  "TIMESHEET_APPROVE_TEAM",
  "TIMESHEET_APPROVE_ANY",
  // Timecards
  "TIMECARD_VIEW_TEAM",
  "TIMECARD_VIEW_ANY",
  "TIMECARD_EDIT_TEAM",
  "TIMECARD_EDIT_ANY",
  // Leave
  "LEAVE_REQUEST_OWN",
  "LEAVE_REQUEST_TEAM",
  "LEAVE_REQUEST_ANY",
  "LEAVE_APPROVE_TEAM",
  "LEAVE_APPROVE_ANY",
  // Accruals
  "ACCRUAL_VIEW_OWN",
  "ACCRUAL_VIEW_TEAM",
  "ACCRUAL_VIEW_ANY",
  "ACCRUAL_ADJUST_ANY",
  // Payroll & admin
  "PAY_PERIOD_MANAGE",
  // Run payroll: lock and unlock pay periods and single timecards, push to ADP
  "PAYROLL_RUN",
  "EMPLOYEE_MANAGE",
  // See your own people's employee details (Team Members), read only
  "EMPLOYEE_VIEW_TEAM",
  // Download everything CloudTime holds about one person, for a data access request
  "EMPLOYEE_DATA_EXPORT",
  // Download everything CloudTime holds for the whole company, to move it to
  // another system. System Admins only unless a company ticks it for a role.
  "COMPANY_DATA_EXPORT",
  "RULES_MANAGE",
  // Rules Setup, and the Company Setup areas that need RULES_MANAGE, read only
  "RULES_VIEW",
  "AUDIT_VIEW",
  "SITE_MANAGE",
  // Sites and departments in Company Setup, and each site's page, read only
  "SITE_VIEW",
  // Documents
  "DOCUMENT_UPLOAD",
  "DOCUMENT_VIEW_ANY",
  "DOCUMENT_VIEW_OWN",
  // Reports
  "REPORT_MANAGE",
  "REPORT_SCHEDULE",
  // Role management
  "ROLE_MANAGE",
  // On Site: who is in the building right now, across a whole site
  "PRESENCE_VIEW_ANY",
  // Live Attendance: replace a person's time clock photo
  "PRESENCE_PHOTO_EDIT",
  // Live Attendance: remove a person's time clock photo, so their next time
  // clock scan takes a new one. Its own grant, so a role can remove without
  // being able to put a photo of its own choosing in.
  "PRESENCE_PHOTO_REMOVE",
  // Live Attendance: hear when the gate turns away somebody with no shift
  // today, and add them to today's schedule
  "PRESENCE_SCHEDULE_ADD",
  // Live Attendance: add visitors, print their badges, renew them and end
  // their access (src/lib/visitors)
  "VISITOR_MANAGE",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Who may change an open timecard, so every edit on the Timecards screen checks the same thing. */
export const TIMECARD_EDITORS: Permission[] = ["PAY_PERIOD_MANAGE", "PUNCH_EDIT_TEAM", "TIMECARD_EDIT_TEAM"];
/** Of those, who reaches the whole company rather than their own team. */
export const TIMECARD_EDITORS_COMPANY: Permission[] = ["PAY_PERIOD_MANAGE", "PUNCH_EDIT_ANY", "TIMECARD_EDIT_ANY"];
/**
 * Who may fix a missed punch on a timecard: every editor, and a role allowed
 * that alone (Bergen's supervisors, 11/05: HR keeps every other change; 11/10
 * on regular hours rows only, and meal waivers but not meal premium waivers).
 * The actions that take it hold a fixer to the missed punch itself
 * (lib/timecards/missed-punch-fix).
 */
export const MISSED_PUNCH_FIXERS: Permission[] = [...TIMECARD_EDITORS, "PUNCH_FIX_MISSED_TEAM"];
/** Who may open Rules Setup and its Company Setup areas: to change them, or only to look. */
export const RULES_READERS: Permission[] = ["RULES_MANAGE", "RULES_VIEW"];
/** Who may open sites and departments: to change them, or only to look. */
export const SITE_READERS: Permission[] = ["SITE_MANAGE", "SITE_VIEW"];

const rolePermissions: Record<Role, Permission[]> = {
  EMPLOYEE: ["PUNCH_OWN", "TIMESHEET_SUBMIT_OWN", "LEAVE_REQUEST_OWN", "DOCUMENT_VIEW_OWN", "ACCRUAL_VIEW_OWN"],
  // A supervisor fixes their team's missed punches; every other timecard
  // change is HR's or payroll's (11/05).
  SUPERVISOR: [
    "PUNCH_OWN",
    "PUNCH_VIEW_TEAM",
    "PUNCH_FIX_MISSED_TEAM",
    "TIMESHEET_SUBMIT_OWN",
    "TIMESHEET_APPROVE_TEAM",
    "LEAVE_REQUEST_OWN",
    "LEAVE_REQUEST_TEAM",
    "LEAVE_APPROVE_TEAM",
    "DOCUMENT_VIEW_OWN",
    "TIMECARD_VIEW_TEAM",
    "ACCRUAL_VIEW_OWN",
    "ACCRUAL_VIEW_TEAM",
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
    "LEAVE_REQUEST_TEAM",
    "LEAVE_REQUEST_ANY",
    "LEAVE_APPROVE_TEAM",
    "LEAVE_APPROVE_ANY",
    "TIMECARD_VIEW_TEAM",
    "TIMECARD_VIEW_ANY",
    "TIMECARD_EDIT_TEAM",
    "TIMECARD_EDIT_ANY",
    "PAY_PERIOD_MANAGE",
    "AUDIT_VIEW",
    "DOCUMENT_UPLOAD",
    "DOCUMENT_VIEW_ANY",
    "REPORT_MANAGE",
    "REPORT_SCHEDULE",
    "ACCRUAL_VIEW_OWN",
    "ACCRUAL_VIEW_ANY",
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
    "LEAVE_REQUEST_TEAM",
    "LEAVE_REQUEST_ANY",
    "LEAVE_APPROVE_TEAM",
    "LEAVE_APPROVE_ANY",
    "TIMECARD_VIEW_TEAM",
    "TIMECARD_VIEW_ANY",
    "TIMECARD_EDIT_TEAM",
    "TIMECARD_EDIT_ANY",
    "PAY_PERIOD_MANAGE",
    "PAYROLL_RUN",
    "EMPLOYEE_MANAGE",
    "EMPLOYEE_DATA_EXPORT",
    "RULES_MANAGE",
    "AUDIT_VIEW",
    "SITE_MANAGE",
    "DOCUMENT_UPLOAD",
    "DOCUMENT_VIEW_ANY",
    "REPORT_MANAGE",
    "REPORT_SCHEDULE",
    "ROLE_MANAGE",
    "ACCRUAL_VIEW_OWN",
    "ACCRUAL_VIEW_ANY",
    "ACCRUAL_ADJUST_ANY",
    "PRESENCE_VIEW_ANY",
    "PRESENCE_PHOTO_EDIT",
    "PRESENCE_PHOTO_REMOVE",
    "VISITOR_MANAGE",
  ],
  SYSTEM_ADMIN: [...PERMISSIONS],
  SUPER_ADMIN: [...PERMISSIONS],
} satisfies Record<Role, Permission[]>;

export function getPermissions(role: Role): Permission[] {
  return rolePermissions[role] ?? [];
}

export function hasPermission(role: string, permission: Permission): boolean {
  const perms = rolePermissions[role as Role];
  if (!perms) return false;
  return perms.includes(permission);
}
