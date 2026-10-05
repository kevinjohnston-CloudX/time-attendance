"use client";

import { useEffect, useRef } from "react";

/** How long the page's scroll bar stays after the mouse and the page stop moving. */
const IDLE_MS = 1_000;

/**
 * Shows the page's own scroll bar while the mouse moves or the page scrolls,
 * and hides it a second after both stop (see .ta-page-scroll).
 *
 * <p>All it does is put a data-scrolling attribute on the page's <main> and
 * take it off again, which only changes the bar's colour. It never measures
 * the page, never scrolls it and draws nothing: the bar is the browser's own,
 * in a thin lane that is always reserved, so the page's width never changes.
 * A floating bar drawn by hand (rolled back on Oct 5) set Leave Requests
 * jumping on a Mac set to always show scroll bars; this is the standard way.
 */
export function PageScrollReveal() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const main = ref.current?.closest("main");
    if (!main) return;
    let timer = 0;
    let lastMove = 0;

    const reveal = () => {
      if (!main.hasAttribute("data-scrolling")) main.setAttribute("data-scrolling", "");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => main.removeAttribute("data-scrolling"), IDLE_MS);
    };
    // A mouse sends far more moves than this needs; a finger already scrolls the page.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      if (e.timeStamp - lastMove < 100) return;
      lastMove = e.timeStamp;
      reveal();
    };

    main.addEventListener("scroll", reveal, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.clearTimeout(timer);
      main.removeEventListener("scroll", reveal);
      window.removeEventListener("pointermove", onMove);
      main.removeAttribute("data-scrolling");
    };
  }, []);

  return <span ref={ref} hidden />;
}
