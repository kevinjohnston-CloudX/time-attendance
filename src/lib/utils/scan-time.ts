/**
 * Timestamp handling for kiosk scans.
 *
 * The two kiosk flows do not send the same format, and the difference is not
 * cosmetic:
 *
 *   Security gate — "yyyy-MM-dd'T'HH:mm:ss.SSSZ", e.g. 2026-09-15T06:02:11.044-0400.
 *                   Carries its own offset, so it names an absolute instant.
 *   Time Clock    — "yyyy-MM-dd'T'HH:mm:ss.SSS", no offset at all. Only means
 *                   something once you know which zone the tablet was set to.
 *
 * Treating the second as UTC is the classic four-hour timecard error, so the
 * two are separated explicitly here rather than handed to `new Date()` and
 * hoped for.
 *
 * (The Time Clock punch route carries its own copy of the naive-parse logic.
 * It is deliberately left alone — that path is live payroll code — so this
 * module is used only by the newer scan ingest.)
 */

/** True when the string names its own UTC offset, and so needs no timezone. */
export function hasExplicitOffset(raw: string): boolean {
  // Matches a trailing Z, ±HH:MM or ±HHMM, but not the date's own hyphens.
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw.trim());
}

/**
 * Reads a naive local datetime as if it were in `timeZone`, returning the UTC
 * instant. Same approach as the punch route: format the value in the target
 * zone, measure how far that lands from the naive reading, and correct by it.
 */
function parseNaiveInZone(raw: string, timeZone: string): Date {
  const asUtc = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(asUtc.getTime())) {
    throw new Error(`Invalid ScanDateTime: ${raw}`);
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(asUtc);

  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  let hour = get("hour");
  if (hour === 24) hour = 0;

  const localAsUtcMs = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    hour, get("minute"), get("second"),
  );

  return new Date(asUtc.getTime() + (asUtc.getTime() - localAsUtcMs));
}

/**
 * Turns whatever the kiosk sent into a UTC instant.
 *
 * `timeZone` is consulted only when the string carries no offset of its own;
 * pass the employee's site timezone. Throws on anything unparseable rather
 * than silently recording a wrong time — a scan with no time is recoverable,
 * a scan with a confidently wrong time is not.
 */
export function parseScanTime(raw: string, timeZone: string): Date {
  const trimmed = raw.trim();

  if (hasExplicitOffset(trimmed)) {
    // "....SSS-0400" — ISO 8601 basic offset. JS needs the colon form.
    const normalised = trimmed.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const parsed = new Date(normalised);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ScanDateTime: ${raw}`);
    }
    return parsed;
  }

  return parseNaiveInZone(trimmed, timeZone);
}
