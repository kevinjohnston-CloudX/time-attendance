"use client";

import { useEffect } from "react";

/**
 * Keeps the screen from dimming or locking while the badge is open, so it is
 * still showing when the person reaches the reader. Released when they leave
 * the page; asked again when they come back to it. Where the browser has no
 * screen wake lock this does nothing and the badge works the same.
 */
export function KeepScreenOn() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (gone) void l.release();
          else lock = l;
        })
        .catch(() => {}); // refused (low battery, no gesture yet): the badge still shows
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, []);
  return null;
}
