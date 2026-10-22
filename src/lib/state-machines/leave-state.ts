import { LeaveRequestStatus } from "@prisma/client";

type ValidTransition = { valid: true; newStatus: LeaveRequestStatus };
type InvalidTransition = { valid: false; error: string };
export type LeaveTransitionResult = ValidTransition | InvalidTransition;

type LeaveEvent = "SUBMIT" | "APPROVE" | "REJECT" | "POST" | "CANCEL" | "REVERT";

const TRANSITIONS: Record<
  LeaveRequestStatus,
  Partial<Record<LeaveEvent, LeaveRequestStatus>>
> = {
  DRAFT: {
    SUBMIT: LeaveRequestStatus.PENDING,
    CANCEL: LeaveRequestStatus.CANCELLED,
  },
  PENDING: {
    APPROVE: LeaveRequestStatus.PENDING_HR,
    REJECT: LeaveRequestStatus.REJECTED,
    CANCEL: LeaveRequestStatus.CANCELLED,
  },
  PENDING_HR: {
    APPROVE: LeaveRequestStatus.APPROVED,
    REJECT: LeaveRequestStatus.REJECTED,
    CANCEL: LeaveRequestStatus.CANCELLED,
    REVERT: LeaveRequestStatus.PENDING,
  },
  APPROVED: {
    POST: LeaveRequestStatus.POSTED,
    REJECT: LeaveRequestStatus.REJECTED,
    CANCEL: LeaveRequestStatus.CANCELLED,
    REVERT: LeaveRequestStatus.PENDING_HR,
  },
  REJECTED: {},
  CANCELLED: {},
  POSTED: {},
};

/** Where a request stands, and what was tried, as the refusal says them. */
const STATUS_WORDS: Record<LeaveRequestStatus, string> = {
  DRAFT: "still a draft",
  PENDING: "waiting for the supervisor",
  PENDING_HR: "waiting for HR",
  APPROVED: "already approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  POSTED: "already posted to the timecard",
};
const EVENT_WORDS: Record<LeaveEvent, string> = {
  SUBMIT: "submitted",
  APPROVE: "approved",
  REJECT: "rejected",
  POST: "posted",
  CANCEL: "cancelled",
  REVERT: "sent back",
};

export function validateLeaveTransition(
  currentStatus: LeaveRequestStatus,
  event: LeaveEvent
): LeaveTransitionResult {
  const newStatus = TRANSITIONS[currentStatus]?.[event];
  if (newStatus === undefined) {
    return {
      valid: false,
      // Usually somebody else acted on it since the page loaded.
      error: `This request is ${STATUS_WORDS[currentStatus]}, so it can't be ${EVENT_WORDS[event]}. Reload the page to see where it stands.`,
    };
  }
  return { valid: true, newStatus };
}

