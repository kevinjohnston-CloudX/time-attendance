"use client";

import { useEffect, useState } from "react";
import { formatSwitchSpot, parseSwitchSpot, SWITCH_SPOT_COOKIE } from "@/lib/design-switch";

/**
 * The classic design's end date notice, shared by both designs' switches so
 * it behaves the same in each and closing it in one closes it in the other.
 *
 * <p>It opens by itself once after every sign in, pinned, and closes only
 * with its X; after that, hovering or focusing the icon shows it until the
 * pointer leaves. "Closed for this sign in" is remembered per browser against
 * the sign in's own id, so signing out and back in brings it up again. No end
 * date, no notice.
 */
const SEEN_KEY = "ct.design-notice.closed";

function closedFor(signInId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === signInId;
  } catch {
    return false;
  }
}

function rememberClosed(signInId: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, signInId);
  } catch {
    // Storage blocked: it simply opens again on the next page load.
  }
}

export function useDesignNotice(classicUntil: string | null, signInId: string) {
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);

  // Read after mount, since storage only exists in the browser; deferred so
  // the effect does not set state inline.
  useEffect(() => {
    if (!classicUntil || closedFor(signInId)) return;
    const t = setTimeout(() => setPinned(true), 0);
    return () => clearTimeout(t);
  }, [classicUntil, signInId]);

  function close() {
    setPinned(false);
    setHovering(false);
    rememberClosed(signInId);
  }

  return { open: pinned || hovering, pinned, setHovering, close };
}

/**
 * Records where the new design's switch sits (see SWITCH_SPOT_COOKIE), for
 * the size of window it is in now. Called by the new design's switch.
 */
export function rememberSwitchSpot(el: HTMLElement) {
  const right = document.documentElement.clientWidth - el.getBoundingClientRect().right;
  const wide = window.matchMedia("(min-width: 64rem)").matches;
  const current = document.cookie.split("; ").find((c) => c.startsWith(`${SWITCH_SPOT_COOKIE}=`));
  const spot = parseSwitchSpot(current?.slice(SWITCH_SPOT_COOKIE.length + 1));
  const before = wide ? spot.wide : spot.narrow;
  if (Math.abs(before - right) < 0.01 && current) return;
  const next = wide ? { ...spot, wide: right } : { ...spot, narrow: right };
  document.cookie = `${SWITCH_SPOT_COOKIE}=${formatSwitchSpot(next)}; path=/; max-age=31536000; samesite=lax`;
}
