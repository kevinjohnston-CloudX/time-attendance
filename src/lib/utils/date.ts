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

/**
 * PostgreSQL date-only columns arrive as UTC midnight Date objects.
 * Convert to local midnight so format() and getDay() use the intended calendar date.
 */
export function parseUtcDate(d: Date | string): Date {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Returns UTC midnight of the local calendar date for `utcDate` in `timezone`.
 * Used to assign a segment to the correct calendar day when the server runs UTC.
 *
 * Example: 2026-03-03T01:25:00Z in America/New_York (EST -5)
 *          → local date is 2026-03-02 → returns 2026-03-02T00:00:00Z
 */
export function startOfDayInTz(utcDate: Date, timezone: string): Date {
  const localDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(utcDate);
  const [y, m, d] = localDateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Returns the UTC timestamp of the next midnight in `timezone`.
 * Used for cross-midnight segment splitting so the split happens at the
 * employee's local midnight, not UTC midnight.
 *
 * Example: 2026-03-03T01:25:00Z in America/New_York (EST -5)
 *          → next local midnight is 2026-03-03 00:00 EST = 2026-03-03T05:00:00Z
 *
 * Uses formatToParts to avoid parsing locale strings — Node 18+ changed
 * toLocaleString to use narrow no-break spaces (U+202F) which new Date()
 * cannot parse, producing Invalid Date and causing infinite recursion in
 * buildSegmentSpan when end <= NaN is always false.
 */
export function nextMidnightInTz(utcDate: Date, timezone: string): Date {
  const localDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(utcDate);
  const [y, m, d] = localDateStr.split("-").map(Number);
  const nextDayAsIfUtc = new Date(Date.UTC(y, m - 1, d + 1));

  // Use formatToParts for reliable structured output (no locale string parsing).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(nextDayAsIfUtc);

  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  let hours = get("hour");
  if (hours === 24) hours = 0;

  // Build the UTC timestamp for what the local clock shows at nextDayAsIfUtc.
  // Then: nextMidnight = 2 * nextDayAsIfUtc - localEquivalent
  // (same as the original offsetMs trick but without locale string parsing)
  const localEquivalentMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hours,
    get("minute"),
    get("second")
  );

  return new Date(2 * nextDayAsIfUtc.getTime() - localEquivalentMs);
}
