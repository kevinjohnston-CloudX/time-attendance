/**
 * Leave amounts in seconds, exact to the hundredth of an hour as NovaTime
 * keeps them: 0.01 h is 36 seconds, so 0.56 h is 2016 seconds and 6.16 h is
 * 22176, where whole minutes made them 34 and 370 (0.57 and 6.17). A minute
 * from a punch is 60 seconds, so punched leave stays exact too.
 */

/** Hours as entered or set in a policy, to the nearest hundredth, in seconds. */
export function hoursToSeconds(hours: number): number {
  return Math.round(hours * 100) * 36;
}

/** Hours to the hundredth, as NovaTime and the payroll file show them. */
export function secondsToHours(seconds: number): number {
  return Math.round(seconds / 36) / 100;
}

/** Whole minutes, for whatever still counts in minutes (and the hours-and-minutes display). */
export function secondsToMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}
