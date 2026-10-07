"use client";

import { useEffect, useState } from "react";
import { getSiteTablets } from "@/lib/presence/reads";
import type { BuildingTablets } from "@/lib/presence/tablets.service";

const REFRESH_MS = 60_000;

/**
 * The building's tablets for Live Attendance: the chip under the title and
 * the Tablets window read the same answer. Asked when the building changes
 * and every minute after (a tablet checks in every five), only for viewers
 * who may see the list.
 */
export function useSiteTablets(siteId: string | null, enabled: boolean) {
  const [state, setState] = useState<{ siteId: string; data: BuildingTablets | null; error: string | null; at: number } | null>(
    null,
  );
  // Bumped by Try again, to ask straight away.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !siteId) return;
    let dead = false;
    const load = async () => {
      try {
        const r = await getSiteTablets({ siteId });
        if (dead) return;
        setState((prev) => ({
          siteId,
          // A failed refresh keeps what was already on screen.
          data: r.success ? r.data : prev?.siteId === siteId ? prev.data : null,
          error: r.success
            ? null
            : r.error === "FORBIDDEN"
              ? "Your role does not include the tablet list."
              : "The tablet list did not load. Check your connection and try again.",
          at: Date.now(),
        }));
      } catch {
        if (!dead)
          setState((prev) => ({
            siteId,
            data: prev?.siteId === siteId ? prev.data : null,
            error: "The tablet list did not load. Check your connection and try again.",
            at: Date.now(),
          }));
      }
    };
    void load();
    // A hidden tab skips its minute and asks again the moment it is looked
    // at, the way the gate alert check does.
    const t = window.setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [siteId, enabled, attempt]);

  const mine = state && state.siteId === siteId ? state : null;
  return {
    data: mine?.data ?? null,
    error: mine?.error ?? null,
    at: mine?.at ?? 0,
    retry: () => setAttempt((n) => n + 1),
  };
}
