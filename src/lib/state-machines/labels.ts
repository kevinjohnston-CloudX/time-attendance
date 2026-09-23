/**
 * Client-safe label maps and types for state machines.
 * These don't import from @prisma/client so they can be used in "use client" components.
 */

// ─── Punch ────────────────────────────────────────────────────────────────────

export type PunchStateValue = "OUT" | "WORK" | "MEAL" | "BREAK";
export type PunchTypeValue =
  | "CLOCK_IN"
  | "CLOCK_OUT"
  | "MEAL_START"
  | "MEAL_END"
  | "BREAK_START"
  | "BREAK_END";

export const PUNCH_STATE_LABEL: Record<PunchStateValue, string> = {
  OUT: "Clocked Out",
  WORK: "Working",
  MEAL: "Meal Break",
  BREAK: "On Break",
};

export const PUNCH_TYPE_LABEL: Record<PunchTypeValue, string> = {
  CLOCK_IN: "Clock In",
  CLOCK_OUT: "Clock Out",
  MEAL_START: "Start Meal",
  MEAL_END: "End Meal",
  BREAK_START: "Start Break",
  BREAK_END: "End Break",
};

/** Available punch types for a given state (client-safe version). */
const PUNCH_TRANSITIONS: Record<PunchStateValue, PunchTypeValue[]> = {
  OUT: ["CLOCK_IN"],
  WORK: ["CLOCK_OUT", "MEAL_START", "BREAK_START"],
  MEAL: ["MEAL_END"],
  BREAK: ["BREAK_END"],
};

export function getAvailablePunchTypes(state: PunchStateValue): PunchTypeValue[] {
  return PUNCH_TRANSITIONS[state] ?? [];
}

// ─── Timesheet ────────────────────────────────────────────────────────────────

export type TimesheetStatusValue =
  | "OPEN"
  | "SUBMITTED"
  | "SUP_APPROVED"
  | "PAYROLL_APPROVED"
  | "LOCKED"
  | "REJECTED";

export const TIMESHEET_STATUS_LABEL: Record<TimesheetStatusValue, string> = {
  OPEN: "Open",
  SUBMITTED: "Submitted",
  SUP_APPROVED: "Supervisor Approved",
  PAYROLL_APPROVED: "Payroll Approved",
  LOCKED: "Locked",
  REJECTED: "Rejected",
};

// ─── Pay Period ───────────────────────────────────────────────────────────────

export type PayPeriodStatusValue = "OPEN" | "READY" | "LOCKED";

export const PAY_PERIOD_STATUS_LABEL: Record<PayPeriodStatusValue, string> = {
  OPEN: "Open",
  READY: "Ready for Lock",
  LOCKED: "Locked",
};

// ─── Leave ────────────────────────────────────────────────────────────────────

export type LeaveRequestStatusValue =
  | "DRAFT"
  | "PENDING"
  | "PENDING_HR"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "POSTED";

export const LEAVE_STATUS_LABEL: Record<LeaveRequestStatusValue, string> = {
  DRAFT: "Draft",
  PENDING: "Pending Supervisor",
  PENDING_HR: "Pending HR",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  POSTED: "Posted",
};

// LEAVE_STATUS_BADGE lived here as a map of Tailwind classes. Colour is now
// leaveTone() in @/components/ui, so a leave status is the same colour on
// every screen and flips with the theme. Labels stay here; only colour moved.

/**
 * Exception types as people read them. The same words the Exceptions screen
 * and the dashboard use, in one place for new screens to share.
 */
export const EXCEPTION_TYPE_LABEL: Record<string, string> = {
  MISSING_PUNCH: "Missing Punch",
  ABSENT: "Absent",
  SCAN_DISCREPANCY: "Scan Discrepancy",
  MISSED_MEAL: "Missed Meal",
  SHORT_BREAK: "Short Break",
  LONG_SHIFT: "Long Shift",
  UNSCHEDULED_OT: "Unscheduled OT",
  LATE_IN: "Late In",
  EARLY_OUT: "Early Out",
  CONSECUTIVE_DAYS: "Consecutive Days",
};
