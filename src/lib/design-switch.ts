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

/** The same page on the other site, marked as arriving by the switch. */
export function switchedHref(origin: string, pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set(DESIGN_SWITCH_PARAM, DESIGN_SWITCH_VALUE);
  return `${origin}${pathname}?${params.toString()}`;
}
