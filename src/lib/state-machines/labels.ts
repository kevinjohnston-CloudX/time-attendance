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
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "POSTED";

export const LEAVE_STATUS_LABEL: Record<LeaveRequestStatusValue, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  POSTED: "Posted",
};

export const LEAVE_STATUS_BADGE: Record<LeaveRequestStatusValue, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  PENDING: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
  POSTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};
