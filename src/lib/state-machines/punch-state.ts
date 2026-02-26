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

export function validateTransition(
  currentState: PunchState,
  punchType: PunchType
): TransitionResult {
  const newState = TRANSITIONS[currentState]?.[punchType];
  if (newState === undefined) {
    return {
      valid: false,
      error: `Cannot ${punchType} when current state is ${currentState}`,
    };
  }
  return { valid: true, newState };
}

export function getAvailablePunchTypes(state: PunchState): PunchType[] {
  return Object.keys(TRANSITIONS[state] ?? {}) as PunchType[];
}

export const PUNCH_STATE_LABEL: Record<PunchState, string> = {
  OUT: "Clocked Out",
  WORK: "Working",
  MEAL: "Meal Break",
  BREAK: "On Break",
};

export const PUNCH_TYPE_LABEL: Record<PunchType, string> = {
  CLOCK_IN: "Clock In",
  CLOCK_OUT: "Clock Out",
  MEAL_START: "Start Meal",
  MEAL_END: "End Meal",
  BREAK_START: "Start Break",
  BREAK_END: "End Break",
};
