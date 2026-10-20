/**
 * An inactive employee's timecards are closed: nothing on them changes and no
 * new one is made, by anybody. To correct a final paycheck, make them active,
 * correct it, and make them inactive again. Payroll may still lock or unlock
 * one. Time was being added and timecards made for people after they had left
 * (10 timecards, 4 people, by October 2026).
 */
export const INACTIVE_TIMECARD_ERROR =
  "This employee is inactive, so their timecards can't be changed and no new ones are made. To correct one, make them active again first.";

export function assertActiveForChange(isActive: boolean): void {
  if (!isActive) throw new Error(INACTIVE_TIMECARD_ERROR);
}
