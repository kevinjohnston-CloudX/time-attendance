"use client";

import { useEffect, useState } from "react";
import { DESIGN_SWITCH_PARAM, DESIGN_SWITCH_VALUE } from "@/lib/design-switch";

/**
 * On the not found screen: when the visit came from the design switch, this
 * design simply does not have that page yet, so it steps up to the parent
 * address (keeping the marker) until it reaches one it has, and the
 * Dashboard at the top. Any other visit gets the not found screen as before.
 */
export function DesignSwitchFallback({ children }: { children: React.ReactNode }) {
  const [stepping, setStepping] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(DESIGN_SWITCH_PARAM) !== DESIGN_SWITCH_VALUE) return;
    const parts = url.pathname.split("/").filter(Boolean);
    parts.pop();
    const parent = parts.length ? `/${parts.join("/")}` : "/dashboard";
    // Deferred so the effect does not set state synchronously on mount.
    const t = setTimeout(() => {
      setStepping(true);
      window.location.replace(`${parent}?${DESIGN_SWITCH_PARAM}=${DESIGN_SWITCH_VALUE}`);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return stepping ? null : <>{children}</>;
}
