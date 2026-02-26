import { startOfDay } from "date-fns";

/**
 * Round a Date to the nearest interval of `roundingMinutes`.
 * If roundingMinutes is 0 or falsy, returns the original time unchanged.
 */
export function applyRounding(time: Date, roundingMinutes: number): Date {
  if (!roundingMinutes) return time;
  const ms = roundingMinutes * 60 * 1000;
  return new Date(Math.round(time.getTime() / ms) * ms);
}

/**
 * Returns the start of today in the local timezone.
 */
export function today(): Date {
  return startOfDay(new Date());
}
