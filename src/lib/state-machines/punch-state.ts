import { PunchState, PunchType } from "@prisma/client";

type ValidTransition = { valid: true; newState: PunchState };
type InvalidTransition = { valid: false; error: string };
export type TransitionResult = ValidTransition | InvalidTransition;

const TRANSITIONS: Record<PunchState, Partial<Record<PunchType, PunchState>>> =
  {
    OUT: {
      CLOCK_IN: PunchState.WORK,
    },
    WORK: {
      CLOCK_OUT: PunchState.OUT,
      MEAL_START: PunchState.MEAL,
      BREAK_START: PunchState.BREAK,
    },
    MEAL: {
      MEAL_END: PunchState.WORK,
    },
    BREAK: {
      BREAK_END: PunchState.WORK,
    },
  };

/** Where the employee is, and the punch tried, as the refusal says them (to them, and in the refused punches list). */
const STATE_WORDS: Record<PunchState, string> = {
  OUT: "Already clocked out",
  WORK: "Already clocked in",
  MEAL: "On a meal",
  BREAK: "On a break",
};
const PUNCH_WORDS: Record<PunchType, string> = {
  CLOCK_IN: "clock in",
  CLOCK_OUT: "clock out",
  MEAL_START: "meal start",
  MEAL_END: "meal end",
  BREAK_START: "break start",
  BREAK_END: "break end",
};

export function validateTransition(
  currentState: PunchState,
  punchType: PunchType
): TransitionResult {
  const newState = TRANSITIONS[currentState]?.[punchType];
  if (newState === undefined) {
    return {
      valid: false,
      error: `${STATE_WORDS[currentState] ?? "In the wrong state"}, so the ${PUNCH_WORDS[punchType] ?? "punch"} wasn't recorded.`,
    };
  }
  return { valid: true, newState };
}

export function getAvailablePunchTypes(state: PunchState): PunchType[] {
  return Object.keys(TRANSITIONS[state] ?? {}) as PunchType[];
}

