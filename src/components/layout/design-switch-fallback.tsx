"use client";

import { useEffect, useState } from "react";
import {
  DESIGN_COOKIE,
  DESIGN_SWITCH_PARAM,
  DESIGN_SWITCH_VALUE,
  parseDesign,
  switchHref,
} from "@/lib/design-switch";

/**
 * On the not found screen, which every address neither design has lands on.
 *
 * <p>Arrived by the design switch: the design just picked does not have that
 * page, so it steps up to the parent address (keeping the marker) until it
 * reaches one it has, and the Dashboard at the top, instead of switching back.
 *
 * <p>On Classic otherwise: the classic design has no such page, and the new
 * one may (Live Attendance is New only), so it opens the same address in New.
 * This browser switches, the person's saved choice does not: a stray link
 * never changes their design for good, and the next sign in brings Classic
 * back. If New has no such page either, its not found screen shows.
 *
 * <p>Any other visit gets the not found screen as before.
 */
function currentDesign(): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${DESIGN_COOKIE}=`));
  return parseDesign(hit?.slice(DESIGN_COOKIE.length + 1)) ?? null;
}

export function DesignSwitchFallback({ children }: { children: React.ReactNode }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    let target: string | null = null;
    if (url.searchParams.get(DESIGN_SWITCH_PARAM) === DESIGN_SWITCH_VALUE) {
      const parts = url.pathname.split("/").filter(Boolean);
      parts.pop();
      const parent = parts.length ? `/${parts.join("/")}` : "/dashboard";
      target = `${parent}?${DESIGN_SWITCH_PARAM}=${DESIGN_SWITCH_VALUE}`;
    } else if (currentDesign() === "classic" || currentDesign() === null) {
      // No cookie is Classic too (the default).
      target = `${switchHref("new", `${url.pathname}${url.search}`)}&remember=0`;
    }
    if (!target) return;
    // Deferred so the effect does not set state synchronously on mount.
    const t = setTimeout(() => {
      setLeaving(true);
      window.location.replace(target);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return leaving ? null : <>{children}</>;
}
