/**
 * Site calendar days as YYYY-MM-DD strings, shared by the server that bounds
 * its queries with them and the pickers that offer them. Pure, so both sides
 * count "the last seven days" the same way.
 */

/** How far back On Site lets anybody look: today and the six days before. */
export const DAYS_BACK = 6;

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Today first, then each day before it. */
export function recentDays(today: string): string[] {
  return Array.from({ length: DAYS_BACK + 1 }, (_, i) => addDays(today, -i));
}

/** A day the viewer may open, or null for anything outside the window. */
export function clampDay(raw: unknown, today: string): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return recentDays(today).includes(raw) ? raw : null;
}

/** "Today", "Yesterday", "Mon, Sep 21". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
