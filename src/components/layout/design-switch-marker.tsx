"use client";

import { useEffect } from "react";
import { DESIGN_SWITCH_PARAM, DESIGN_SWITCH_VALUE } from "@/lib/design-switch";

/**
 * Once a page has opened after a design switch, the switch's marker has done
 * its job (the not found screen reads it first, since a child's effect runs
 * before this one), so it leaves the address bar and a copied or bookmarked
 * address never carries it.
 */
export function DesignSwitchMarkerCleanup() {
  useEffect(() => {
    // After this render's effects, so Next's router has taken over the
    // history by then and adopts the shorter address. Sooner, the router
    // starts up afterwards and puts back the address it began with.
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      if (url.searchParams.get(DESIGN_SWITCH_PARAM) !== DESIGN_SWITCH_VALUE) return;
      url.searchParams.delete(DESIGN_SWITCH_PARAM);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return null;
}
