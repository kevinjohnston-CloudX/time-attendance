import { PayPeriodStatus } from "@prisma/client";

type ValidTransition = { valid: true; newStatus: PayPeriodStatus };
type InvalidTransition = { valid: false; error: string };
export type PayPeriodTransitionResult = ValidTransition | InvalidTransition;

type PayPeriodEvent = "MARK_READY" | "LOCK" | "REOPEN";

const TRANSITIONS: Record<
  PayPeriodStatus,
  Partial<Record<PayPeriodEvent, PayPeriodStatus>>
> = {
  OPEN: {
    MARK_READY: PayPeriodStatus.READY,
  },
  READY: {
    LOCK: PayPeriodStatus.LOCKED,
    REOPEN: PayPeriodStatus.OPEN,
  },
  LOCKED: {
    REOPEN: PayPeriodStatus.OPEN,
  },
};

export function validatePayPeriodTransition(
  currentStatus: PayPeriodStatus,
  event: PayPeriodEvent
): PayPeriodTransitionResult {
  const newStatus = TRANSITIONS[currentStatus]?.[event];
  if (newStatus === undefined) {
    return {
      valid: false,
      error: `Cannot ${event} a pay period in ${currentStatus} status`,
    };
  }
  return { valid: true, newStatus };
}

export const PAY_PERIOD_STATUS_LABEL: Record<PayPeriodStatus, string> = {
  OPEN: "Open",
  READY: "Ready for Lock",
  LOCKED: "Locked",
};
