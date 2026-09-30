"use client";

import { useEffect, useState } from "react";
import { PageSpinner } from "@/components/layout/page-spinner";
import {
  DESIGN_PROBE_HEADER,
  DESIGN_SWITCH_PARAM,
  DESIGN_SWITCH_VALUE,
  switchHref,
  type Design,
} from "@/lib/design-switch";

/**
 * On the not found screen, which every address neither design has lands on.
 *
 * <p>Arrived by the design switch: the design just picked does not have that
 * page, so it steps up to the parent address (keeping the marker) until it
 * reaches one it has, and the Dashboard at the top, instead of switching back.
 *
 * <p>On Classic otherwise: New may have the page (Live Attendance is New
 * only), so New is asked first, for this one request. When it has it, the
 * same address opens in New for this browser; the person's saved choice does
 * not change, so the next sign in brings Classic back. When it does not (a
 * mistyped address, a page nobody has), the not found screen shows and
 * nothing switches. Nothing is drawn while New is asked, so a page New has
 * never flashes a not found screen first.
 *
 * <p>On New, any other visit gets the not found screen as before.
 */
const AUTH_PAGES = ["/login", "/forgot-password", "/setup-password", "/change-password"];

export function DesignSwitchFallback({ design, children }: { design: Design; children: React.ReactNode }) {
  const [shown, setShown] = useState(design !== "classic");

  useEffect(() => {
    const url = new URL(window.location.href);
    const here = `${url.pathname}${url.search}`;

    if (url.searchParams.get(DESIGN_SWITCH_PARAM) === DESIGN_SWITCH_VALUE) {
      const parts = url.pathname.split("/").filter(Boolean);
      parts.pop();
      const parent = parts.length ? `/${parts.join("/")}` : "/dashboard";
      window.location.replace(`${parent}?${DESIGN_SWITCH_PARAM}=${DESIGN_SWITCH_VALUE}`);
      return;
    }
    if (design !== "classic") return;
    // Both designs have the sign in pages, so one missing is the server
    // mid restart, never a page to find in New. And an address is handed to
    // New once per browser session at most: a second time means New sent it
    // back, and asking again would only go round in circles.
    if (AUTH_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
      queueMicrotask(() => setShown(true));
      return;
    }
    const tried = `ct-design-tried:${url.pathname}`;
    try {
      if (sessionStorage.getItem(tried)) {
        queueMicrotask(() => setShown(true));
        return;
      }
    } catch {
      // No storage: the switch below is still one hop, never a loop, since
      // New draws the page (that is what the answer said).
    }

    let cancelled = false;
    fetch(here, {
      method: "HEAD",
      headers: { [DESIGN_PROBE_HEADER]: "new" },
      redirect: "manual",
      cache: "no-store",
    })
      .then((res) => {
        if (cancelled) return;
        // Only a page New actually draws counts. A redirect (no access, signed
        // out) or a not found there too leaves this screen as it is.
        if (res.status === 200) {
          try {
            sessionStorage.setItem(tried, "1");
          } catch {
            // See above.
          }
          window.location.replace(`${switchHref("new", here)}&remember=0`);
        } else setShown(true);
      })
      .catch(() => {
        if (!cancelled) setShown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [design]);

  return shown ? <>{children}</> : <PageSpinner />;
}
