import { PayPeriodStatus } from "@prisma/client";

type ValidTransition = { valid: true; newStatus: PayPeriodStatus };
type InvalidTransition = { valid: false; error: string };
export type PayPeriodTransitionResult = ValidTransition | InvalidTransition;

type PayPeriodEvent = "LOCK" | "REOPEN";

// A period is Open until it is locked. READY is no longer entered; periods
// left in it by the old approval flow can still be locked or reopened.
const TRANSITIONS: Record<
  PayPeriodStatus,
  Partial<Record<PayPeriodEvent, PayPeriodStatus>>
> = {
  OPEN: {
    LOCK: PayPeriodStatus.LOCKED,
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
