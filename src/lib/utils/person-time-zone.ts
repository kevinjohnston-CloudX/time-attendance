/**
 * The time zone a person's times are read in: their own, when their record
 * sets one, else their site's.
 *
 * <p>A record sets one for someone who works in another zone than their site,
 * such as a Rey 11 person (an Eastern site) working in California. Everything
 * that reads that person's times goes through here: typed timecard entries and
 * corrections, the timecard calculation, punch history, reports, the jobs that
 * close open punches. Live Attendance and the tablets stay with the building.
 */
export function personTimeZone(
  person: { timeZone?: string | null; site?: { timezone?: string | null } | null } | null | undefined,
  fallback = "America/New_York",
): string {
  return person?.timeZone || person?.site?.timezone || fallback;
}

/** The zones the employee record offers, by the name people know them by. */
export const TIME_ZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Mountain, no daylight saving (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Toronto", label: "Eastern, Canada (Toronto)" },
  { value: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
  { value: "Europe/Amsterdam", label: "Central Europe (Amsterdam)" },
  { value: "Europe/London", label: "United Kingdom (London)" },
];

export function timeZoneLabel(zone: string | null | undefined): string {
  if (!zone) return "";
  return TIME_ZONE_OPTIONS.find((z) => z.value === zone)?.label ?? zone;
}
