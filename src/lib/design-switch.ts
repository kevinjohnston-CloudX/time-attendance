/**
 * The design switch: the classic design and this one run as two sites on one
 * database, and the switch opens the page you are on in the other one.
 *
 * <p>The other site's address is a setting, CLASSIC_DESIGN_URL, read on the
 * server on every request, so it can be set or changed on the host without a
 * rebuild. Unset, the switch is not drawn at all.
 *
 * <p>It carries the path and the query unchanged, since both sites have the
 * same pages over the same records. When the other site has no such page, the
 * marker below tells its not found screen to step up to the nearest page it
 * does have, so a page added to one design later never strands anyone.
 */
export const DESIGN_SWITCH_PARAM = "via";
export const DESIGN_SWITCH_VALUE = "design-switch";

/** The classic site's origin, or null when the switch is off. */
export function classicDesignUrl(): string | null {
  const raw = process.env.CLASSIC_DESIGN_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The last day the classic design is offered, from CLASSIC_DESIGN_UNTIL
 * (YYYY-MM-DD, a day in the company's Eastern time). Null when unset or not a
 * real date: no end date is shown, and the switch stays.
 */
export function classicDesignUntil(): { day: string; label: string } | null {
  const raw = process.env.CLASSIC_DESIGN_UNTIL?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(+date) || date.toISOString().slice(0, 10) !== raw) return null;
  const label = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return { day: raw, label };
}

/** Whether that last day is behind us, counted in Eastern time. */
export function classicDesignEnded(until: { day: string } | null, now = new Date()): boolean {
  if (!until) return false;
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return today > until.day;
}

/** The same page on the other site, marked as arriving by the switch. */
export function switchedHref(origin: string, pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set(DESIGN_SWITCH_PARAM, DESIGN_SWITCH_VALUE);
  return `${origin}${pathname}?${params.toString()}`;
}
