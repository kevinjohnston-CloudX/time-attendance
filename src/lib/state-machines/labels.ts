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
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const LEAVE_STATUS_LABEL: Record<LeaveRequestStatusValue, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
