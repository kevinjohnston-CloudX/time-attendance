/**
 * Maps legacy permission strings to the new (resource, action, scope) model.
 * This allows existing server actions using withRBAC("PUNCH_EDIT_ANY", ...)
 * to work without modification.
 */

export type PermissionTuple = {
  resource: string;
  action: "read" | "write" | "execute";
  scope: "own" | "team" | "all";
};

export const LEGACY_MAP: Record<string, PermissionTuple> = {
  // Punch
  PUNCH_OWN:              { resource: "punch",     action: "write",   scope: "own" },
  PUNCH_VIEW_TEAM:        { resource: "punch",     action: "read",    scope: "team" },
  PUNCH_EDIT_TEAM:        { resource: "punch",     action: "write",   scope: "team" },
  PUNCH_EDIT_ANY:         { resource: "punch",     action: "write",   scope: "all" },
  // Timesheet
  TIMESHEET_SUBMIT_OWN:   { resource: "timesheet", action: "write",   scope: "own" },
  TIMESHEET_APPROVE_TEAM: { resource: "timesheet", action: "execute", scope: "team" },
  TIMESHEET_APPROVE_ANY:  { resource: "timesheet", action: "execute", scope: "all" },
  // Leave
  LEAVE_REQUEST_OWN:      { resource: "leave",     action: "write",   scope: "own" },
  LEAVE_APPROVE_TEAM:     { resource: "leave",     action: "execute", scope: "team" },
  LEAVE_APPROVE_ANY:      { resource: "leave",     action: "execute", scope: "all" },
  // Payroll & admin
  PAY_PERIOD_MANAGE:      { resource: "payroll",   action: "write",   scope: "all" },
  EMPLOYEE_MANAGE:        { resource: "employee",  action: "write",   scope: "all" },
  RULES_MANAGE:           { resource: "rules",     action: "write",   scope: "all" },
  AUDIT_VIEW:             { resource: "audit",     action: "read",    scope: "all" },
  SITE_MANAGE:            { resource: "site",      action: "write",   scope: "all" },
  // Documents
  DOCUMENT_UPLOAD:        { resource: "document",  action: "write",   scope: "own" },
  DOCUMENT_VIEW_ANY:      { resource: "document",  action: "read",    scope: "all" },
  DOCUMENT_VIEW_OWN:      { resource: "document",  action: "read",    scope: "own" },
  // Reports
  REPORT_MANAGE:          { resource: "report",    action: "write",   scope: "all" },
  REPORT_SCHEDULE:        { resource: "report",    action: "execute", scope: "all" },
  // Role management
  ROLE_MANAGE:            { resource: "role",      action: "write",   scope: "all" },
};
