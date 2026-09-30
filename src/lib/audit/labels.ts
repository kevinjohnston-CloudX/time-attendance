import type { AuditEntityType } from "@prisma/client";

/**
 * Plain names for what the audit log records, for people who never see the
 * codes. The code stays on screen beside the name, so support can still
 * search for it.
 */

export const ENTITY_TYPES: AuditEntityType[] = [
  "EMPLOYEE",
  "USER",
  "PUNCH",
  "TIMESHEET",
  "PAY_PERIOD",
  "LEAVE_REQUEST",
  "LEAVE_BALANCE",
  "PTO_POLICY",
  "RULE_SET",
  "ROLE",
  "DOCUMENT",
  "REPORT",
  "ADP_SYNC",
];

export const ENTITY_LABEL: Record<AuditEntityType, string> = {
  USER: "User account",
  EMPLOYEE: "Employee",
  PUNCH: "Punch",
  TIMESHEET: "Timesheet",
  PAY_PERIOD: "Pay period",
  LEAVE_REQUEST: "Leave request",
  LEAVE_BALANCE: "Leave balance",
  RULE_SET: "Rule set",
  DOCUMENT: "Document",
  ADP_SYNC: "ADP sync",
  REPORT: "Report",
  ROLE: "Role",
  PTO_POLICY: "Leave policy",
};

/** Actions whose code already says what happened. */
const NAMED: Record<string, string> = {
  EXCEPTION_RESOLVED: "Exception resolved",
  MANUAL_PUNCH_ADDED: "Manual punch added",
  MANUAL_PUNCH_DELETED: "Manual punch deleted",
  PUNCH_RECORDED: "Punch recorded",
  PUNCH_CORRECTED: "Punch corrected",
  PUNCH_ADDED: "Punch added",
  PUNCH_DELETED: "Punch deleted",
  MISSED_PUNCH_REQUESTED: "Missed punch requested",
  MISSED_PUNCH_APPROVED: "Missed punch approved",
  TIMESHEET_SUBMITTED: "Timesheet submitted",
  TIMESHEET_SUP_APPROVED: "Timesheet approved by supervisor",
  TIMESHEET_PAYROLL_APPROVED: "Timesheet approved by payroll",
  TIMESHEET_REJECTED: "Timesheet sent back",
  TIMESHEET_LOCKED: "Timecard locked",
  ADP_FILE_EXPORTED: "ADP payroll file generated",
  TIMESHEET_UNLOCKED: "Timecard unlocked",
  TIMECARD_DEDUCTION: "Timecard deduction",
  BULK_SUP_APPROVE: "Open timesheets approved",
  OT_AUTHORIZED: "Overtime authorized",
  MEAL_WAIVER_ADDED: "Meal waiver added",
  MEAL_WAIVER_REMOVED: "Meal waiver removed",
  MEAL_PREMIUM_WAIVER_ADDED: "Meal premium waiver added",
  MEAL_PREMIUM_WAIVER_REMOVED: "Meal premium waiver removed",
  SCHEDULE_DAY_ADDED: "Schedule day added",
  PAYROLL_LEAVE_ADDED: "Leave added by payroll",
  PAYROLL_LEAVE_REMOVED: "Leave removed by payroll",
  EMPLOYEE_CREATED: "Employee added",
  EMPLOYEES_BULK_CREATED: "Employees added in bulk",
  EMPLOYEE_UPDATED: "Employee updated",
  EMPLOYEE_PHOTO_UPDATED: "Employee photo updated",
  LEAVE_BALANCE_ADJUSTED: "Leave balance adjusted",
  LEAVE_BALANCE_RESET_TO_ACCRUAL: "Leave balance reset to accrual",
  BALANCE_RESET: "Leave balance reset",
  EARNED_ADJUSTMENT: "Earned leave adjusted",
  CARRY_OVER: "Leave carried over",
  ACCRUAL: "Leave accrued",
  USAGE: "Leave used",
  ADJUSTMENT: "Leave balance adjusted",
  POLICY_CHANGE: "Leave policy changed",
  LEAVE_TYPE_CREATED: "Leave type added",
  LEAVE_TYPE_UPDATED: "Leave type updated",
  PTO_POLICY_CREATED: "Leave policy added",
  PTO_POLICY_UPDATED: "Leave policy updated",
  PTO_POLICY_DELETED: "Leave policy deleted",
  RULE_SET_CREATED: "Rule set added",
  RULE_SET_UPDATED: "Rule set updated",
  RULE_SET_DELETED: "Rule set deleted",
  SITE_CREATED: "Site added",
  SITE_UPDATED: "Site updated",
  DEPARTMENT_CREATED: "Department added",
  DEPARTMENT_UPDATED: "Department updated",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_DELETED: "Document deleted",
  REPORT_CREATED: "Report added",
  REPORT_DELETED: "Report deleted",
  ADP_SYNC_COMPLETED: "ADP sync completed",
  ADP_PAYROLL_PUSHED: "Payroll sent to ADP",
  VIEW_AS_STARTED: "View as started",
  SUPER_ADMIN_ENTERED: "Super admin entered the company",
  LOGIN_FAILED: "Sign in failed",
  SETTINGS_UPDATE: "Company settings updated",
  LOCK: "Pay period locked",
  REOPEN: "Pay period reopened",
  MARK_READY: "Pay period marked ready",
};

/** Actions that only say what happened, so the record type names the thing. */
const VERBS: Record<string, string> = {
  CREATE: "added",
  CREATED: "added",
  UPDATE: "updated",
  UPDATED: "updated",
  DELETE: "deleted",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  POSTED: "posted",
};

export function actionLabel(action: string, entityType: AuditEntityType): string {
  if (NAMED[action]) return NAMED[action];
  if (VERBS[action]) return `${ENTITY_LABEL[entityType] ?? "Record"} ${VERBS[action]}`;
  const words = action.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The action codes whose plain name contains the search, so "sent back" finds TIMESHEET_REJECTED. */
export function actionsMatching(q: string): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return Object.entries(NAMED)
    .filter(([, label]) => label.toLowerCase().includes(s))
    .map(([code]) => code);
}
