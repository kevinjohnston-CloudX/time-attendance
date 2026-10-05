"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** How long the bar stays after the mouse or the page stops moving. */
const IDLE_MS = 1_000;
/** The shortest the thumb gets on a very long page, so it stays easy to grab. */
const MIN_THUMB = 40;

/**
 * The page's scrolling area, with a floating scroll bar in place of the
 * browser's own.
 *
 * <p>The browser's bar sits in a white track of its own down the right edge
 * on any Mac set to always show scroll bars and on every Windows machine,
 * which reads as an empty button beside the page. This one floats over the
 * page with no track: a thin thumb that shows while the mouse moves or the
 * page scrolls, and fades out a second after both stop. It can still be
 * dragged, and keyboard, wheel and touch scrolling are the browser's own,
 * untouched.
 *
 * <p>The scrolling element is still the page's <main>, so anything that
 * looks for it (a "back to top", a header that shrinks on scroll) finds it
 * as before.
 */
export function PageScroller({ children }: { children: ReactNode }) {
  const mainRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const main = mainRef.current;
    const rail = railRef.current;
    const thumb = thumbRef.current;
    if (!main || !rail || !thumb) return;

    let hideTimer = 0;
    let dragging: { pointerId: number; startY: number; startTop: number } | null = null;
    let overThumb = false;

    const measure = () => {
      const view = main.clientHeight;
      const full = main.scrollHeight;
      if (full <= view + 1) {
        rail.dataset.scrollable = "false";
        return null;
      }
      rail.dataset.scrollable = "true";
      const size = Math.max(MIN_THUMB, Math.round((view * view) / full));
      const room = view - size;
      const top = room * (main.scrollTop / (full - view));
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translateY(${Math.round(top)}px)`;
      return { view, full, size, room };
    };

    const hideLater = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!dragging && !overThumb) rail.dataset.shown = "false";
      }, IDLE_MS);
    };

    const show = () => {
      if (!measure()) return;
      rail.dataset.shown = "true";
      hideLater();
    };

    const onPointerDown = (e: PointerEvent) => {
      const m = measure();
      if (!m) return;
      e.preventDefault();
      thumb.setPointerCapture(e.pointerId);
      dragging = { pointerId: e.pointerId, startY: e.clientY, startTop: main.scrollTop };
      rail.dataset.dragging = "true";
      rail.dataset.shown = "true";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== dragging.pointerId) return;
      const m = measure();
      if (!m || m.room <= 0) return;
      main.scrollTop = dragging.startTop + ((e.clientY - dragging.startY) * (m.full - m.view)) / m.room;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== dragging.pointerId) return;
      dragging = null;
      rail.dataset.dragging = "false";
      hideLater();
    };
    const onEnter = () => {
      overThumb = true;
      window.clearTimeout(hideTimer);
    };
    const onLeave = () => {
      overThumb = false;
      hideLater();
    };

    // Only the mouse brings it up; a finger already scrolls with the page.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || e.pointerType === "pen") show();
    };

    measure();
    main.addEventListener("scroll", show, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    thumb.addEventListener("pointerdown", onPointerDown);
    thumb.addEventListener("pointermove", onPointerMove);
    thumb.addEventListener("pointerup", onPointerUp);
    thumb.addEventListener("pointercancel", onPointerUp);
    thumb.addEventListener("pointerenter", onEnter);
    thumb.addEventListener("pointerleave", onLeave);
    // The page grows and shrinks as data loads and panels open.
    const resized = new ResizeObserver(() => measure());
    resized.observe(main);
    if (main.firstElementChild) resized.observe(main.firstElementChild);
    const changed = new MutationObserver(() => measure());
    changed.observe(main, { childList: true });

    return () => {
      window.clearTimeout(hideTimer);
      main.removeEventListener("scroll", show);
      window.removeEventListener("pointermove", onMove);
      thumb.removeEventListener("pointerdown", onPointerDown);
      thumb.removeEventListener("pointermove", onPointerMove);
      thumb.removeEventListener("pointerup", onPointerUp);
      thumb.removeEventListener("pointercancel", onPointerUp);
      thumb.removeEventListener("pointerenter", onEnter);
      thumb.removeEventListener("pointerleave", onLeave);
      resized.disconnect();
      changed.disconnect();
    };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <main ref={mainRef} className="ta-scroll-hidden min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
      <div ref={railRef} className="ta-page-rail" data-shown="false" data-scrollable="false" aria-hidden="true">
        <div ref={thumbRef} className="ta-page-thumb" />
      </div>
    </div>
  );
}
