import { timingSafeEqual } from "node:crypto";

/**
 * Whether a time clock or gate request carries the tablets' key
 * (`x-api-key: <TIMECLOCK_API_KEY>`). Compared in constant time, and refused
 * when the key is not set. Five routes compared it with `!==`.
 */
export function timeclockKeyValid(req: Request): boolean {
  const expected = process.env.TIMECLOCK_API_KEY;
  const given = req.headers.get("x-api-key");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
