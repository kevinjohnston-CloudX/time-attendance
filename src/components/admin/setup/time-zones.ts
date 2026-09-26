/**
 * Time zones in words. A site stores an IANA name ("America/New_York"),
 * which is what punches are stamped against, but HR reads "Eastern
 * (New York)". The zones the company uses come first; every other zone the
 * browser knows is still offered after them, so nothing that could be typed
 * before is lost.
 */

const COMMON: { id: string; label: string }[] = [
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Phoenix", label: "Arizona (Phoenix)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska (Anchorage)" },
  { id: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { id: "America/Toronto", label: "Eastern (Toronto)" },
  { id: "America/Puerto_Rico", label: "Atlantic (Puerto Rico)" },
  { id: "Europe/Amsterdam", label: "Central European (Amsterdam)" },
  { id: "Europe/London", label: "United Kingdom (London)" },
];

const LABELS = new Map(COMMON.map((z) => [z.id, z.label]));

/** "Eastern (New York)" for a zone we name, else the city from the IANA name. */
export function timeZoneLabel(id: string | null | undefined): string {
  if (!id) return "";
  return LABELS.get(id) ?? id.split("/").pop()!.replace(/_/g, " ");
}

/** The picker's options: the common zones, then every other one, plus the current value if it is neither. */
export function timeZoneOptions(current?: string | null): { common: typeof COMMON; others: { id: string; label: string }[] } {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  const others = all
    .filter((id) => !LABELS.has(id))
    .map((id) => ({ id, label: id.replace(/_/g, " ") }));
  if (current && !LABELS.has(current) && !all.includes(current)) others.unshift({ id: current, label: current });
  return { common: COMMON, others };
}
