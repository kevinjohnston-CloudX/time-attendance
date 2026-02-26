import { TimesheetStatus } from "@prisma/client";

type ValidTransition = { valid: true; newStatus: TimesheetStatus };
type InvalidTransition = { valid: false; error: string };
export type TimesheetTransitionResult = ValidTransition | InvalidTransition;

type TimesheetEvent =
  | "SUBMIT"
  | "SUP_APPROVE"
  | "SUP_REJECT"
  | "PAYROLL_APPROVE"
  | "PAYROLL_REJECT"
  | "LOCK";

const TRANSITIONS: Record<
  TimesheetStatus,
  Partial<Record<TimesheetEvent, TimesheetStatus>>
> = {
  OPEN: {
    SUBMIT: TimesheetStatus.SUBMITTED,
  },
  SUBMITTED: {
    SUP_APPROVE: TimesheetStatus.SUP_APPROVED,
    SUP_REJECT: TimesheetStatus.OPEN,
  },
  SUP_APPROVED: {
    PAYROLL_APPROVE: TimesheetStatus.PAYROLL_APPROVED,
    PAYROLL_REJECT: TimesheetStatus.OPEN,
  },
  PAYROLL_APPROVED: {
    LOCK: TimesheetStatus.LOCKED,
  },
  LOCKED: {},
};

export function validateTimesheetTransition(
  currentStatus: TimesheetStatus,
  event: TimesheetEvent
): TimesheetTransitionResult {
  const newStatus = TRANSITIONS[currentStatus]?.[event];
  if (newStatus === undefined) {
    return {
      valid: false,
      error: `Cannot ${event} a timesheet in ${currentStatus} status`,
    };
  }
  return { valid: true, newStatus };
}

export const TIMESHEET_STATUS_LABEL: Record<TimesheetStatus, string> = {
  OPEN: "Open",
  SUBMITTED: "Submitted",
  SUP_APPROVED: "Supervisor Approved",
  PAYROLL_APPROVED: "Payroll Approved",
  LOCKED: "Locked",
};
