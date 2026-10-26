/**
 * Hours typed by hand are kept in whole minutes, so a value between two
 * minutes is saved as the nearer one: 7.76 hours (465.6 minutes) is saved as
 * 466 minutes, which reads 7.77. Says so, or null when the value is kept as
 * typed (7.75, 7.80, any whole-minute amount).
 */
export function roundedHoursNote(typed: string): string | null {
  const hours = Number(typed);
  if (typed.trim() === "" || !Number.isFinite(hours) || hours <= 0) return null;
  const shown = Math.round(hours * 60) / 60;
  if (Math.abs(Number(shown.toFixed(2)) - hours) < 0.0001) return null;
  // Leave is kept to the hundredth (lib/leave-time); worked hours, placed
  // as a clock in and out, are still kept to the minute.
  return `As worked hours this saves as ${shown.toFixed(2)}: worked time is kept to the minute. Under a leave code such as PTO it stays ${hours}.`;
}
