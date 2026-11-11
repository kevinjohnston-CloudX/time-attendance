/**
 * Notices when CloudTime has been deployed again while a tab sat open, and
 * whether the page that tab is on actually changed (the new version banner,
 * components/layout/new-version-banner.tsx).
 *
 * <p>A tab keeps running the code it loaded. Moving to another page after a
 * deploy is already safe: Next sees the build changed and loads that page
 * fresh. What goes stale is a tab that stays on one page, like Live
 * Attendance on a desk all day, which keeps last week's screen and can fail
 * on a button whose server code has moved on.
 *
 * <p>The tab knows its own build (baked in at build time, next.config.ts).
 * The live build arrives two ways, neither touching the database: the Live
 * Attendance pulse carries it on every answer (every 2 seconds), and every
 * other page asks /api/app-build when the tab comes back into view and once
 * a minute while it is in view.
 *
 * <p>Whether this page changed comes from each build's page fingerprints
 * (scripts/build-page-map.mjs), fetched as small static files: the tab's own
 * at load, while its build is still the one being served, and the new one
 * when it arrives. Anything uncertain (no fingerprints, a page that cannot be
 * matched) counts as changed: staying quiet wrongly is the worse mistake.
 */

/** The build this tab is running. "local" on a laptop. */
export const TAB_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "";

/** The answer header the pulse and /api/app-build carry. */
export const APP_BUILD_HEADER = "x-app-build";

export type PageMap = Record<string, string>;
export type Verdict = "yes" | "no" | "unknown";

let liveBuild: string | null = null;
const listeners = new Set<(build: string) => void>();

/**
 * Record the build an answer came from. A build other than the tab's own
 * means a deploy landed while the tab was open; a later, different one is
 * reported again, so a dismissed banner can come back for the next deploy.
 */
export function reportBuild(build: string | null | undefined): void {
  if (!build || !TAB_BUILD || build === TAB_BUILD || build === liveBuild) return;
  liveBuild = build;
  for (const fn of listeners) fn(build);
}

/** Called with each newer build; at once if one was already seen. */
export function onNewBuild(fn: (build: string) => void): () => void {
  listeners.add(fn);
  if (liveBuild) fn(liveBuild);
  return () => {
    listeners.delete(fn);
  };
}

const maps = new Map<string, Promise<PageMap | null>>();

/** A build's page fingerprints, once per build per tab; null when it has none. */
export function pageMapFor(build: string): Promise<PageMap | null> {
  let map = maps.get(build);
  if (!map) {
    map = fetch(`/_next/static/cloudtime-build/${encodeURIComponent(encodeURIComponent(build))}.json`)
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { build?: string; pages?: PageMap };
        return body.build === build && body.pages ? body.pages : null;
      })
      .catch(() => null);
    maps.set(build, map);
  }
  return map;
}

/**
 * Match an address ("/supervisor/on-site") to a fingerprint key
 * ("/(portal)/supervisor/on-site/page"). Group folders "(x)" are not part of
 * the address. The most literal match wins, as in the router: "/leave/new"
 * beats "/leave/[id]".
 */
export function routeKeyFor(pathname: string, keys: string[]): string | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeSafe);
  let best: string | null = null;
  let bestScore = -1;
  for (const key of keys) {
    if (!key.endsWith("/page")) continue;
    const segs = key
      .slice(0, -"/page".length)
      .split("/")
      .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
    const score = matchScore(parts, segs);
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** -1 for no match; otherwise higher is more specific (a literal segment counts double). */
function matchScore(parts: string[], segs: string[]): number {
  let score = 0;
  let i = 0;
  for (let j = 0; j < segs.length; j++) {
    const seg = segs[j];
    if (seg.startsWith("[...") || seg.startsWith("[[...")) {
      if (i >= parts.length && !seg.startsWith("[[")) return -1;
      return score + 1;
    }
    if (i >= parts.length) return -1;
    if (seg.startsWith("[")) score += 1;
    else if (seg === parts[i]) score += 2;
    else return -1;
    i++;
  }
  return i === parts.length ? score : -1;
}

/** Did the page at this address change between the two builds' fingerprints? */
export function pageChanged(pathname: string, from: PageMap | null, to: PageMap | null): Verdict {
  if (!from || !to) return "unknown";
  const key = routeKeyFor(pathname, Object.keys(to));
  if (!key || !(key in from)) return "unknown";
  return from[key] === to[key] ? "no" : "yes";
}

/** Ask the server which build it is serving now. Never throws. */
export async function checkLiveBuild(): Promise<void> {
  try {
    const res = await fetch("/api/app-build", { cache: "no-store" });
    // Signed out: the proxy answers with the sign in page. Nothing to learn.
    if (!res.ok || res.redirected) return;
    const body = (await res.json()) as { build?: string };
    reportBuild(body.build ?? res.headers.get(APP_BUILD_HEADER));
  } catch {
    // Offline or between deploys; the next ask makes up for it.
  }
}
