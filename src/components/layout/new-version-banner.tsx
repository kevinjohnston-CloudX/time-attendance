"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TAB_BUILD, checkLiveBuild, onNewBuild, pageChanged, pageMapFor, type Verdict } from "@/lib/app-build";
import styles from "./new-version-banner.module.css";

/**
 * "CloudTime has been updated": offered when a newer build is live and the
 * page this tab is sitting on changed in it (lib/app-build.ts). The same
 * rules as the ticketing system's prompt:
 *
 * <p>Only when it matters. A deploy that left this page alone stays silent;
 * moving to a page that did change asks then. Anything uncertain asks.
 *
 * <p>Never a refresh by itself. Somebody may be halfway through a form, and
 * losing it to pick up a deploy is worse than old code. They refresh when it
 * suits them, or say Not now, which holds until the next deploy.
 *
 * <p>Drawn at the bottom of the page area, above everything on the page
 * (Live Attendance's full screen included) and below any open window, so a
 * window is finished first. On a phone it sits above the bottom bar; the app
 * shows it the same way.
 */

/** How often a tab in view asks; the Live Attendance pulse tells it sooner. */
const ASK_EVERY_MS = 60_000;
/** Coming back into view asks at once, but not twice in a few seconds. */
const ASK_GAP_MS = 5_000;
/** The leaving animation, before the banner is taken away. */
const LEAVE_MS = 180;

export function NewVersionBanner() {
  const pathname = usePathname() ?? "/";
  const [live, setLive] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ build: string; path: string; value: Verdict } | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [center, setCenter] = useState<number | null>(null);
  const leaveTimer = useRef<number | null>(null);

  // This tab's own fingerprints, while its build is still the one served:
  // after the next deploy they are gone from the server.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && TAB_BUILD && TAB_BUILD !== "local") void pageMapFor(TAB_BUILD);
  }, []);

  useEffect(() => onNewBuild(setLive), []);

  // Ask when the tab comes back into view, and every minute while in view.
  useEffect(() => {
    let last = 0;
    const ask = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < ASK_GAP_MS) return;
      last = Date.now();
      void checkLiveBuild();
    };
    document.addEventListener("visibilitychange", ask);
    window.addEventListener("focus", ask);
    window.addEventListener("online", ask);
    const id = window.setInterval(ask, ASK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", ask);
      window.removeEventListener("focus", ask);
      window.removeEventListener("online", ask);
      window.clearInterval(id);
    };
  }, []);

  // Did this page change in the newer build? Asked again on each page.
  useEffect(() => {
    if (!live) return;
    let gone = false;
    void Promise.all([pageMapFor(TAB_BUILD), pageMapFor(live)]).then(([from, to]) => {
      if (!gone) setVerdict({ build: live, path: pathname, value: pageChanged(pathname, from, to) });
    });
    return () => {
      gone = true;
    };
  }, [live, pathname]);

  useEffect(
    () => () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const show =
    !!live && verdict?.build === live && verdict.path === pathname && verdict.value !== "no" && dismissed !== live;

  // Centred on the page area, not the window, so the sidebar does not pull
  // it off to one side; on the whole window in a browser full screen.
  useLayoutEffect(() => {
    if (!show) return;
    const place = () => {
      const main = document.querySelector<HTMLElement>("main.ta-page-scroll");
      const box = !document.fullscreenElement && main ? main.getBoundingClientRect() : null;
      setCenter(box && box.width > 0 ? box.left + box.width / 2 : window.innerWidth / 2);
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("fullscreenchange", place);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("fullscreenchange", place);
    };
  }, [show]);

  if (!show) return null;

  const notNow = () => {
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => {
      setDismissed(live);
      setLeaving(false);
    }, LEAVE_MS);
  };

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={styles.banner}
      data-leaving={leaving || undefined}
      style={center === null ? undefined : ({ "--nvb-center": `${center}px` } as React.CSSProperties)}
    >
      <span className={styles.glyph} aria-hidden="true">
        <RefreshCw />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>CloudTime has been updated</span>
        <span className={styles.line}>Refresh to see the latest version of this page.</span>
      </span>
      <span className={styles.actions}>
        <Button onClick={() => window.location.reload()}>
          <span className={styles.wide}>Refresh page</span>
          <span className={styles.narrow}>Refresh</span>
        </Button>
        <Button hierarchy="tertiary" iconOnly onClick={notNow} aria-label="Not now" title="Not now">
          <X className="h-4 w-4" />
        </Button>
      </span>
    </div>,
    document.body,
  );
}
