/** Format a minute count as "Xh Ym" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "-" : "";
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** Format a minute count as a decimal hour string, e.g. "8.50" */
export function minutesToHoursDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}
