/**
 * The design switch: Classic or New, in one app over one database.
 *
 * <p>Both designs answer the same addresses. The classic screens live under
 * src/app/classic, and the proxy serves them at the ordinary address to
 * anyone whose design is Classic, so the address bar never shows which design
 * a page came from and a link works in either. Nothing lists pages: a page
 * only one design has is handled where it is missing (see the not found
 * screen), so pages added later need no change here.
 *
 * <p>The choice belongs to the person (users.designPreference) and is
 * mirrored in a cookie, which is what the proxy reads, since it cannot reach
 * the database. The cookie is written when somebody flips the switch and
 * again at sign in, from their saved choice, so a new browser or a different
 * person signing in gets their own design. Nobody saved yet means Classic.
 *
 * <p>This module is edge safe (the proxy imports it): no database, no Node.
 */

export type Design = "classic" | "new";

/** Read by the proxy on every request; written by the switch and at sign in. */
export const DESIGN_COOKIE = "ct-design";

/** A year: the choice is the person's, so it outlives any one sign in. */
export const DESIGN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Everyone starts on Classic until they pick New. */
export const DEFAULT_DESIGN: Design = "classic";

/** The folder the classic screens are served from, never shown in the address bar. */
export const CLASSIC_PREFIX = "/classic";

/**
 * Marks a visit that arrived by flipping the switch. On the not found screen
 * it means the design just picked has no such page, so it steps up to the
 * nearest one it does have instead of switching back.
 */
export const DESIGN_SWITCH_PARAM = "via";
export const DESIGN_SWITCH_VALUE = "design-switch";

/**
 * A request header that picks the design for that one request, over the
 * cookie. The not found screen on Classic uses it to ask whether New has the
 * page before switching, so a mistyped address never moves anyone to New. It
 * only chooses which screens draw the page: the same sign in and the same
 * server checks apply either way.
 */
export const DESIGN_PROBE_HEADER = "x-ct-design";

/**
 * Where the new design's switch sits, so the classic one can sit at exactly
 * the same spot and nothing moves when somebody flips between them. It is
 * measured there, because it depends on the controls to its right (the Nav
 * switch and the bell, whose count badge changes width), and kept in a cookie
 * so the classic page is drawn with it from the server, without a jump.
 *
 * <p>The value is "<wide>|<narrow>": how far the switch's right edge is from
 * the window's right edge, in pixels, at 1024px and wider (Tailwind's lg,
 * where its labels show) and below.
 */
export const SWITCH_SPOT_COOKIE = "ct-design-spot";

export type SwitchSpot = { wide: number; narrow: number };

/** Measured with a "99+" bell, for a browser that has not opened New yet. */
export const SWITCH_SPOT_DEFAULT: SwitchSpot = { wide: 324.09, narrow: 286.28 };

const spotPart = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 4000 ? n : fallback;
};

export function parseSwitchSpot(value: string | null | undefined): SwitchSpot {
  const [wide, narrow] = (value ?? "").split("|");
  return {
    wide: spotPart(wide, SWITCH_SPOT_DEFAULT.wide),
    narrow: spotPart(narrow, SWITCH_SPOT_DEFAULT.narrow),
  };
}

export function formatSwitchSpot(spot: SwitchSpot): string {
  return `${spot.wide.toFixed(2)}|${spot.narrow.toFixed(2)}`;
}

export function parseDesign(value: string | null | undefined): Design | null {
  return value === "classic" || value === "new" ? value : null;
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

/** Whether Classic can still be picked at all. After its last day everyone is on New. */
export function classicOffered(now = new Date()): boolean {
  return !classicDesignEnded(classicDesignUntil(), now);
}

/** The design a request is served in, from the cookie alone. */
export function designFromCookie(value: string | null | undefined): Design {
  if (!classicOffered()) return "new";
  return parseDesign(value) ?? DEFAULT_DESIGN;
}

/**
 * Where to send somebody once a design is set: a path on this site only.
 * Anything else (another host, "//host", a scheme) falls back to the
 * dashboard, so the switch can never be turned into an open redirect.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  // Never land on the hidden folder itself; the proxy serves it at the plain address.
  if (next === CLASSIC_PREFIX || next.startsWith(`${CLASSIC_PREFIX}/`)) return next.slice(CLASSIC_PREFIX.length) || "/dashboard";
  return next;
}

/** The address that sets a design and continues to `next`, for plain links. */
export function switchHref(to: Design, next: string, opts: { viaSwitch?: boolean } = {}): string {
  const params = new URLSearchParams({ to, next });
  if (opts.viaSwitch) params.set(DESIGN_SWITCH_PARAM, DESIGN_SWITCH_VALUE);
  return `/api/design?${params.toString()}`;
}

/** After sign in: set this browser to the person's saved design, then continue. */
export function syncHref(next: string): string {
  return `/api/design?${new URLSearchParams({ sync: "1", next }).toString()}`;
}
