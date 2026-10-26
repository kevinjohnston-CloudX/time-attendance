/** Format a minute count as "Xh Ym" */
export function formatMinutes(minutes: number): string {
  // To the whole minute: leave is kept to the hundredth of an hour, so a
  // 0.56 hour line is 33.6 minutes, shown as 34m (lib/leave-time).
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const sign = minutes < 0 ? "-" : "";
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** Format a minute count as a decimal hour string, e.g. "8.50" */
export function minutesToHoursDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}
