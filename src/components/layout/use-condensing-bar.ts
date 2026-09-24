"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A pinned page bar that slims down once the page has scrolled, and grows
 * back at the top. For bars big enough to be worth it: a title, a status line
 * and a full filter row. Returns refs for the bar and for a marker at the top
 * of the page column, whether the bar is slim, and its live height.
 *
 * <p>Measured as the distance between the bar and the marker, so it works
 * whichever element is doing the scrolling, with two thresholds so a page
 * resting on the line cannot flicker.
 *
 * <p>The bar keeps its full footprint while it is slim: the height it gave up
 * comes back as a margin under it (the `--pin-gap` custom property, which the
 * bar's margin-bottom must include), so the page below never moves. The
 * browser's scroll anchoring is also switched off on the scrolling element
 * while the page is open. Together they end a loop where the bar shrank, the
 * list moved up, the browser scrolled back to hold the list still, that
 * unshrank the bar, and the header shuddered between its two sizes.
 *
 * <p>Where the bar does not pin (a narrow or short window, see .ta-pinned),
 * it never slims, since it scrolls away with the page anyway.
 */
export function useCondensingBar() {
  const barRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [condensed, setCondensed] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const condensedRef = useRef(false);
  const fullHeight = useRef(0);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    let frame = 0;
    let clearTimer = 0;

    const setGap = (px: number) => bar.style.setProperty("--pin-gap", `${px}px`);

    // Scroll anchoring off on whatever scrolls this page, put back on leave.
    let scroller: HTMLElement | null = bar.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const target = scroller ?? (document.scrollingElement as HTMLElement | null);
    const previousAnchor = target?.style.overflowAnchor ?? "";
    if (target) target.style.overflowAnchor = "none";

    const read = () => {
      frame = 0;
      const marker = markerRef.current;
      if (!marker) return;
      const pinned = getComputedStyle(bar).position === "sticky";
      const travelled = bar.getBoundingClientRect().top - marker.getBoundingClientRect().top;
      const next = pinned && (condensedRef.current ? travelled > 4 : travelled > 16);
      if (next === condensedRef.current) return;
      if (next) {
        fullHeight.current = bar.getBoundingClientRect().height;
      } else {
        // Normally the gap runs out as the bar grows back. If what the bar
        // holds changed meanwhile it may never reach the old height, so the
        // gap goes once the growing is done.
        window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(() => {
          if (condensedRef.current) return;
          fullHeight.current = 0;
          setGap(0);
        }, 400);
      }
      condensedRef.current = next;
      setCondensed(next);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    // Set straight on the element in the same frame as the resize, so the
    // page under the bar never moves for even one frame.
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            const exact = bar.getBoundingClientRect().height;
            if (fullHeight.current) {
              const gap = Math.max(0, fullHeight.current - exact);
              setGap(gap);
              if (!condensedRef.current && gap === 0) fullHeight.current = 0;
            }
            const h = Math.round(exact);
            setBarHeight((prev) => (prev === h ? prev : h));
          })
        : null;
    ro?.observe(bar);

    read();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
      ro?.disconnect();
      if (target) target.style.overflowAnchor = previousAnchor;
    };
  }, []);

  return { barRef, markerRef, condensed, barHeight };
}
