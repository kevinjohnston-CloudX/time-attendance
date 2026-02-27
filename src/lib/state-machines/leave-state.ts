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

