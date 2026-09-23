"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLinkStatus } from "next/link";
import { usePathname, useRouter as useNextRouter, useSearchParams } from "next/navigation";

/**
 * The thin bar across the top of the window while a page is on its way.
 *
 * <p>The App Router keeps the old page on screen until the server has
 * rendered the new one, which on this database can take a couple of seconds.
 * With nothing moving, people click again, and a second click on an approval
 * is how things get done twice. The bar starts the moment the click lands and
 * finishes when the address changes.
 *
 * <p>Two ways a page change starts, and both report here: a click on a link,
 * caught for the whole document below, and code calling router.push or
 * replace, which goes through the useRouter exported from this file.
 */

/** Below this, the page arrived fast enough that a bar would only flicker. */
const SHOW_AFTER_MS = 150;
/** A navigation that never lands (offline, a request that hangs) stops here. */
const GIVE_UP_MS = 15_000;

type Phase = "idle" | "loading" | "finishing";

let phase: Phase = "idle";
let startedAt = 0;
let giveUp: ReturnType<typeof setTimeout> | undefined;
let finish: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: Phase) {
  phase = next;
  listeners.forEach((l) => l());
}

const store = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get: () => phase,
  getServer: (): Phase => "idle",
};

/** Where an href would take the browser, or null if nowhere new. */
function destination(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // Only the hash differs: the browser scrolls, no page is fetched.
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
  return url;
}

function start(href: string) {
  if (!destination(href)) return;
  clearTimeout(giveUp);
  clearTimeout(finish);
  startedAt = Date.now();
  set("loading");
  giveUp = setTimeout(done, GIVE_UP_MS);
}

function done() {
  clearTimeout(giveUp);
  if (phase !== "loading") return;
  // Never shown yet, so there is nothing to finish: just stop.
  if (Date.now() - startedAt < SHOW_AFTER_MS) return set("idle");
  set("finishing");
  finish = setTimeout(() => set("idle"), 450);
}

/**
 * next/navigation's useRouter, with push and replace reporting to the bar.
 * Use this one anywhere code changes the page, so a click on a table row or
 * a filter shows the same bar a link does.
 */
export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter();
  return useMemo(
    () => ({
      ...router,
      push: (href, options) => {
        start(href);
        router.push(href, options);
      },
      replace: (href, options) => {
        start(href);
        router.replace(href, options);
      },
    }),
    [router],
  );
}

export function NavigationProgress() {
  const current = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // The address changing is the page having arrived.
  useEffect(() => {
    done();
  }, [pathname, search]);

  useEffect(() => {
    // Capture phase, so this sees the click before the Link handles it.
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab or window
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      start(a.href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Rendered while idle too, empty, so a quick page change never mounts it.
  return (
    <div
      className="ta-nav-progress"
      data-state={current}
      role={current === "loading" ? "progressbar" : undefined}
      aria-label={current === "loading" ? "Loading page" : undefined}
      aria-hidden={current === "loading" ? undefined : true}
    />
  );
}


/**
 * A small turning ring, shown only while this Link's own page is loading.
 * Must sit inside the Link: useLinkStatus reads the nearest one.
 */
export function LinkPendingSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <span className="ta-nav-spinner" role="status" aria-label="Loading" /> : null;
}
