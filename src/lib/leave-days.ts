/**
 * The days a time off request takes, as YYYY-MM-DD: the days the person
 * picked, or, for a request with no list of days (imported ones), every day
 * from its first to its last. A request for a Friday and the next Monday is
 * two days off, not four: counting from first to last day put leave on the
 * weekend between, on timecards, calendars and day counts alike.
 *
 * <p>Safe in the browser. Dates are read as calendar days, never in a zone.
 */
export function leaveDayKeys(req: {
  startDate: Date | string;
  endDate: Date | string;
  selectedDays?: unknown;
}): string[] {
  const first = dayKey(req.startDate);
  const last = dayKey(req.endDate);
  if (Array.isArray(req.selectedDays)) {
    const picked = new Set<string>();
    for (const d of req.selectedDays) {
      const date = (d as { date?: unknown } | null)?.date;
      if (typeof date === "string" && date >= first && date <= last) picked.add(date);
    }
    if (picked.size > 0) return [...picked].sort();
  }
  const out: string[] = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function dayKey(d: Date | string): string {
  return (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
}

/**
 * The seconds each picked day carries, keyed YYYY-MM-DD, adding up exactly to
 * the request's total: a partial day its own minutes, the full days sharing
 * the rest equally (a full day is the same shift length for every day, see
 * createLeaveRequestCore). Null when the request has no usable list of days.
 * It used to spread the total over every calendar day from first to last, so
 * a Friday and the next Monday put hours on the weekend between.
 */
export function daySeconds(
  selectedDays: unknown,
  totalSeconds: number,
  firstDay: string,
  lastDay: string,
): Map<string, number> | null {
  if (!Array.isArray(selectedDays) || selectedDays.length === 0) return null;
  const days = selectedDays.filter(
    (d): d is { date: string; type: string; minutes?: number } =>
      !!d && typeof d.date === "string" && d.date >= firstDay && d.date <= lastDay,
  );
  if (days.length === 0) return null;
  const partial = new Map<string, number>();
  const full: string[] = [];
  for (const d of days) {
    if (d.type === "PARTIAL" && typeof d.minutes === "number") {
      partial.set(d.date, (partial.get(d.date) ?? 0) + d.minutes * 60);
    } else if (!full.includes(d.date)) {
      full.push(d.date);
    }
  }
  const partialTotal = [...partial.values()].reduce((a, b) => a + b, 0);
  const out = new Map<string, number>(partial);
  if (full.length > 0) {
    const forFull = Math.max(0, totalSeconds - partialTotal);
    const each = Math.floor(forFull / full.length);
    full.forEach((day, i) => {
      // The last full day takes the rounding, so the days add up to the total.
      const s = i === full.length - 1 ? forFull - each * (full.length - 1) : each;
      out.set(day, (out.get(day) ?? 0) + s);
    });
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
