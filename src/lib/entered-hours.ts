/**
 * Where hours entered with Add time go on their day. They are a clock in and
 * out that only carry the hours (Punch.hoursOnly), from 12:00 AM. A second
 * entry used to land on the first, two 12:00 AM shifts that paid the day
 * twice with one clock in hidden on the timecard (Erika Vera de Romero,
 * 10/15). Now hours under another code start where the day's entered hours
 * end, each on its own row, and the same code again is refused: that entry is
 * changed instead.
 */
export type EnteredHours = { start: Date; end: Date; payCodeId: string | null };

export function placeEnteredHours(
  dayStart: Date,
  minutes: number,
  payCodeId: string | null,
  existing: EnteredHours[],
): { start: Date; end: Date } | { refused: "same-code"; entry: EnteredHours } | { refused: "over-24h" } {
  const same = existing.find((e) => e.payCodeId === payCodeId);
  if (same) return { refused: "same-code", entry: same };
  const start = new Date(Math.max(dayStart.getTime(), ...existing.map((e) => e.end.getTime())));
  const end = new Date(start.getTime() + minutes * 60_000);
  if (end.getTime() - dayStart.getTime() > 24 * 60 * 60_000) return { refused: "over-24h" };
  return { start, end };
}
