/** Which half of the day a typed time is in. Always a control, never a guess. */
export type Meridiem = "AM" | "PM";

/**
 * A typed time of day, read against the AM or PM the field is set to.
 *
 * <p>Nothing here is inferred. A punch entered twelve hours out is a wrong
 * paycheck, not a typo somebody notices, so the half of the day is an explicit
 * control rather than a guess at what 8:30 meant. A time typed on a 24 hour
 * clock is taken as written, because it cannot mean anything else, and an
 * explicit am or pm in the text wins over the control.
 */
export function parseTimeOfDay(input: string, meridiem: Meridiem): { hours: number; minutes: number } | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;

  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (minutes > 59) return null;
  const typed: Meridiem | null = m[3] ? (m[3] === "pm" ? "PM" : "AM") : null;

  if (hours === 0 || (hours >= 13 && hours <= 23)) {
    // A 24 hour time. Saying "13:00 am" is a contradiction, not a correction.
    return typed ? null : { hours, minutes };
  }
  if (hours > 12) return null;

  const half = typed ?? meridiem;
  if (hours === 12) hours = half === "AM" ? 0 : 12;
  else if (half === "PM") hours += 12;
  return { hours, minutes };
}

/** A parsed time as the "HH:mm" schedules store. */
export function toHHmm(t: { hours: number; minutes: number }): string {
  return `${String(t.hours).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")}`;
}
