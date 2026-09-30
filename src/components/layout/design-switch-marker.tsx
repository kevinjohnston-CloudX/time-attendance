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
    const url = new URL(window.location.href);
    if (url.searchParams.get(DESIGN_SWITCH_PARAM) !== DESIGN_SWITCH_VALUE) return;
    url.searchParams.delete(DESIGN_SWITCH_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return null;
}
