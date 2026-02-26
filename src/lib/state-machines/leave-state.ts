import { LeaveRequestStatus } from "@prisma/client";

type ValidTransition = { valid: true; newStatus: LeaveRequestStatus };
type InvalidTransition = { valid: false; error: string };
export type LeaveTransitionResult = ValidTransition | InvalidTransition;

type LeaveEvent = "SUBMIT" | "APPROVE" | "REJECT" | "POST" | "CANCEL";

const TRANSITIONS: Record<
  LeaveRequestStatus,
  Partial<Record<LeaveEvent, LeaveRequestStatus>>
> = {
  DRAFT: {
    SUBMIT: LeaveRequestStatus.PENDING,
    CANCEL: LeaveRequestStatus.CANCELLED,
  },
  PENDING: {
    APPROVE: LeaveRequestStatus.APPROVED,
    REJECT: LeaveRequestStatus.REJECTED,
    CANCEL: LeaveRequestStatus.CANCELLED,
  },
  APPROVED: {
    POST: LeaveRequestStatus.POSTED,
    REJECT: LeaveRequestStatus.REJECTED,
    CANCEL: LeaveRequestStatus.CANCELLED,
  },
  REJECTED: {},
  CANCELLED: {},
  POSTED: {},
};

export function validateLeaveTransition(
  currentStatus: LeaveRequestStatus,
  event: LeaveEvent
): LeaveTransitionResult {
  const newStatus = TRANSITIONS[currentStatus]?.[event];
  if (newStatus === undefined) {
    return {
      valid: false,
      error: `Cannot ${event} a leave request in ${currentStatus} status`,
    };
  }
  return { valid: true, newStatus };
}

export const LEAVE_STATUS_LABEL: Record<LeaveRequestStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  POSTED: "Posted",
};

export const LEAVE_STATUS_BADGE: Record<LeaveRequestStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  PENDING: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
  POSTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};
