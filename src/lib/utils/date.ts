import { startOfDay } from "date-fns";

/**
 * Round a Date to the nearest interval of `roundingMinutes`.
 * `pointMinutes` shifts the rounding grid by an offset (e.g. point=5 with interval=15
 * snaps to :05/:20/:35/:50 instead of :00/:15/:30/:45).
 */
/**
 * Round a raw duration (in minutes) to the nearest interval.
 * `point` shifts the rounding grid (e.g. point=7 with interval=15 rounds to 7, 22, 37, 52...).
 * Returns 0 if interval is 0 or falsy.
 */
export function roundDurationMinutes(minutes: number, interval: number, point = 0): number {
  if (!interval) return minutes;
  if (!point) return Math.round(minutes / interval) * interval;
  return Math.round((minutes - point) / interval) * interval + point;
}

export function applyRounding(time: Date, roundingMinutes: number, pointMinutes = 0): Date {
  if (!roundingMinutes) return time;
  const ms = roundingMinutes * 60_000;
  if (!pointMinutes) return new Date(Math.round(time.getTime() / ms) * ms);
  const pointMs = pointMinutes * 60_000;
  return new Date(Math.round((time.getTime() - pointMs) / ms) * ms + pointMs);
}

/**
 * Snap a local HH:mm time on a given local calendar date to a UTC Date.
 * Uses the same offset-inversion trick as nextMidnightInTz.
 */
export function snapToLocalTime(hhmm: string, localDateStr: string, timezone: string): Date {
  const [y, m, d] = localDateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const asIfUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(asIfUtc);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  let hours = get("hour");
  if (hours === 24) hours = 0;
  const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), hours, get("minute"), get("second"));
  return new Date(2 * asIfUtc.getTime() - localMs);
}

/**
 * Novatime-style shift-aware rounding:
 *   A (shiftRoundingInWindow):  minutes BEFORE shift start → snap clock-in to shift start
 *   B (shiftRoundingInGrace):   minutes AFTER  shift start → snap clock-in to shift start
 *   C (shiftRoundingOutGrace):  minutes BEFORE shift end   → snap clock-out to shift end
 *   D (shiftRoundingOutWindow): minutes AFTER  shift end   → snap clock-out to shift end
 *
 * Falls back to simple applyRounding when:
 *   - shiftRoundingEnabled is false, or no shift assigned
 *   - punchType is not CLOCK_IN / CLOCK_OUT
 *   - the punch day is not a shift workday
 *   - the punch falls outside the shift windows
 */
type RoundingRuleSet = {
  shiftRoundingEnabled: boolean;
  shiftRoundingInWindow: number;
  shiftRoundingInGrace: number;
  shiftRoundingOutGrace: number;
  shiftRoundingOutWindow: number;
  punchRoundingInEnabled: boolean;
  punchRoundingInMinutes: number;
  punchRoundingInPoint: number;
  punchRoundingInApplyToBreaks: boolean;
  punchRoundingOutEnabled: boolean;
  punchRoundingOutMinutes: number;
  punchRoundingOutPoint: number;
  punchRoundingOutApplyToBreaks: boolean;
};

function applyGeneralRounding(time: Date, punchType: string, rs: RoundingRuleSet): Date {
  const isIn  = punchType === "CLOCK_IN"   || (rs.punchRoundingInApplyToBreaks  && ["MEAL_START", "BREAK_START"].includes(punchType));
  const isOut = punchType === "CLOCK_OUT"  || (rs.punchRoundingOutApplyToBreaks && ["MEAL_END",   "BREAK_END"  ].includes(punchType));
  if (isIn  && rs.punchRoundingInEnabled)  return applyRounding(time, rs.punchRoundingInMinutes,  rs.punchRoundingInPoint);
  if (isOut && rs.punchRoundingOutEnabled) return applyRounding(time, rs.punchRoundingOutMinutes, rs.punchRoundingOutPoint);
  return time;
}

export function computeRoundedTime(
  time: Date,
  punchType: string,
  ruleSet: RoundingRuleSet,
  shift: { startTime: string; endTime: string; workDays: number[] } | null | undefined,
  timezone: string,
): Date {
  const isIn  = punchType === "CLOCK_IN";
  const isOut = punchType === "CLOCK_OUT";

  // Shift-aware rounding: only applies to CLOCK_IN / CLOCK_OUT on workdays
  if (ruleSet.shiftRoundingEnabled && shift && (isIn || isOut)) {
    const localDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(time);
    const dow = new Date(localDateStr + "T12:00:00.000Z").getUTCDay();

    if (shift.workDays.includes(dow)) {
      const timeParts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(time);
      const lh = parseInt(timeParts.find((p) => p.type === "hour")?.value ?? "0", 10);
      const lm = parseInt(timeParts.find((p) => p.type === "minute")?.value ?? "0", 10);
      const localMins = (lh === 24 ? 0 : lh) * 60 + lm;

      if (isIn) {
        const [sh, sm] = shift.startTime.split(":").map(Number);
        const startMins = sh * 60 + sm;
        if (localMins >= startMins - ruleSet.shiftRoundingInWindow && localMins <= startMins + ruleSet.shiftRoundingInGrace) {
          return snapToLocalTime(shift.startTime, localDateStr, timezone);
        }
      } else {
        const [eh, em] = shift.endTime.split(":").map(Number);
        const endMins = eh * 60 + em;
        if (localMins >= endMins - ruleSet.shiftRoundingOutGrace && localMins <= endMins + ruleSet.shiftRoundingOutWindow) {
          return snapToLocalTime(shift.endTime, localDateStr, timezone);
        }
      }
    }
  }

  // General per-direction rounding fallback
  return applyGeneralRounding(time, punchType, ruleSet);
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
/**
 * Returns the UTC timestamp for 23:59:59 on `dateStr` ("YYYY-MM-DD") in `timezone`.
 * Used for the auto-close SYSTEM punch so it fires at end-of-day local time
 * rather than end-of-day UTC.
 *
 * Example: dateStr="2026-08-03", timezone="America/New_York" (EDT, UTC-4)
 *          → 2026-08-03T23:59:59 EDT = 2026-08-04T03:59:59Z
 */
/**
 * Given the local calendar date of a clock-in and the employee's shift definition,
 * returns the UTC Date for the shift end and the workday-expansion expiry.
 *
 * For overnight shifts (endTime hour:min <= startTime hour:min), the shift ends
 * on the next calendar day relative to `punchLocalDate`.
 *
 * Used by the auto-clock-out cron and the timeclock punch route to determine
 * whether a late punch still belongs to the previous workday.
 */
export function computeShiftExpiry(
  shift: { startTime: string; endTime: string },
  punchLocalDate: string,
  expansionAfterMinutes: number,
  timezone: string,
): { shiftEndUtc: Date; expiryUtc: Date } {
  const [sh, sm] = shift.startTime.split(":").map(Number);
  const [eh, em] = shift.endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  const isOvernight = endMins <= startMins;

  const [y, mo, d] = punchLocalDate.split("-").map(Number);
  let endDateStr: string;
  if (isOvernight) {
    const nextDay = new Date(Date.UTC(y, mo - 1, d + 1));
    endDateStr = nextDay.toISOString().slice(0, 10);
  } else {
    endDateStr = punchLocalDate;
  }

  const shiftEndUtc = snapToLocalTime(shift.endTime, endDateStr, timezone);
  const expiryUtc = new Date(shiftEndUtc.getTime() + expansionAfterMinutes * 60_000);
  return { shiftEndUtc, expiryUtc };
}

export function endOfDayInTz(dateStr: string, timezone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const asIfUtc = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(asIfUtc);

  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  let hours = get("hour");
  if (hours === 24) hours = 0;

  const localEquivalentMs = Date.UTC(get("year"), get("month") - 1, get("day"), hours, get("minute"), get("second"));
  return new Date(2 * asIfUtc.getTime() - localEquivalentMs);
}

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
