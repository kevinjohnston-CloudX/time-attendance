"use client";

import { useEffect } from "react";
import { isPhone } from "@/lib/phone";

/**
 * Drag a phone sheet down to close it, as every phone app allows.
 *
 * <p>One listener for every .ta-sheet in the app, so no window needs its own
 * code. A drag starts only when the finger moves mostly downward and what it
 * touched is scrolled to its top; otherwise the content scrolls as usual.
 * Let go past a quarter of the sheet's height, or with a flick, and the
 * sheet slides away; short of that it springs back. Numbers from Vaul and
 * Apple's sheets (mobile/phone-rulebook-2026-10-20.md).
 *
 * <p>Closing goes through each window's own way out, in the order a person
 * would try them: the Escape key, a tap on the dimmed backdrop, then its
 * Close or Cancel button. A window that refuses all three (one that is busy
 * saving) springs back rather than vanishing under its own code.
 *
 * <p>Also turns on :active for touches in iOS Safari, which only fires it
 * on a page that listens for touchstart.
 */

const CLOSE_AT = 0.25;
const FLICK = 0.4; // px per ms
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

type Drag = {
  sheet: HTMLElement;
  target: Element;
  x0: number;
  y0: number;
  dy: number;
  lastY: number;
  lastT: number;
  v: number;
  decided: boolean;
  dragging: boolean;
};

/** The nearest box between the finger and the sheet that scrolls up and down. */
function scrollerAbove(target: Element, sheet: HTMLElement): HTMLElement | null {
  for (let el: Element | null = target; el; el = el.parentElement) {
    const h = el as HTMLElement;
    if (h.scrollHeight > h.clientHeight + 1) {
      const oy = getComputedStyle(h).overflowY;
      if (oy === "auto" || oy === "scroll") return h;
    }
    if (el === sheet) break;
  }
  return null;
}

const frames = (n: number) =>
  new Promise<void>((done) => {
    const step = (k: number) => (k <= 0 ? done() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });

async function closeSheet(sheet: HTMLElement): Promise<boolean> {
  const gone = () => !sheet.isConnected;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await frames(2);
  if (gone()) return true;

  const scrim = sheet.closest(".ta-sheet-scrim") ?? sheet.parentElement;
  if (scrim && scrim !== document.body) {
    const at = { bubbles: true, cancelable: true, clientX: 1, clientY: 1 };
    scrim.dispatchEvent(new PointerEvent("pointerdown", at));
    scrim.dispatchEvent(new MouseEvent("mousedown", at));
    scrim.dispatchEvent(new MouseEvent("mouseup", at));
    scrim.dispatchEvent(new MouseEvent("click", at));
    await frames(2);
    if (gone()) return true;
  }

  const button = sheet.querySelector<HTMLButtonElement>(
    'button[aria-label="Close"]:not(:disabled), button[data-cancel]:not(:disabled)',
  );
  if (button) {
    button.click();
    await frames(2);
  }
  return gone();
}

export function SheetGestures() {
  useEffect(() => {
    let d: Drag | null = null;

    const settle = (sheet: HTMLElement, y: number, ms: number) => {
      sheet.style.transition = `transform ${ms}ms ${EASE}`;
      sheet.style.transform = y ? `translateY(${y}px)` : "";
    };
    const release = (sheet: HTMLElement) => {
      sheet.style.transition = "";
      sheet.style.transform = "";
      delete sheet.dataset.dragging;
    };

    const onStart = (e: TouchEvent) => {
      d = null;
      if (e.touches.length !== 1 || !isPhone()) return;
      const target = e.target as Element | null;
      const sheet = target?.closest<HTMLElement>(".ta-sheet");
      if (!target || !sheet) return;
      // Typing, picking and sliding keep the finger.
      if (target.closest("input, textarea, select, [contenteditable], [data-no-sheet-drag]")) return;
      const t = e.touches[0];
      d = { sheet, target, x0: t.clientX, y0: t.clientY, dy: 0, lastY: t.clientY, lastT: e.timeStamp, v: 0, decided: false, dragging: false };
    };

    const onMove = (e: TouchEvent) => {
      if (!d) return;
      const t = e.touches[0];
      const dx = t.clientX - d.x0;
      const dy = t.clientY - d.y0;
      if (!d.decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        d.decided = true;
        const scroller = scrollerAbove(d.target, d.sheet);
        d.dragging = dy > 0 && Math.abs(dy) > Math.abs(dx) && (!scroller || scroller.scrollTop <= 0);
        if (!d.dragging) {
          d = null;
          return;
        }
        d.sheet.dataset.dragging = "";
        d.sheet.style.transition = "none";
      }
      e.preventDefault();
      // Past the top it resists, as a native sheet does, rather than lifting.
      const y = dy >= 0 ? dy : -Math.sqrt(-dy) * 2;
      d.sheet.style.transform = `translateY(${y}px)`;
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.v = (t.clientY - d.lastY) / dt;
      d.lastY = t.clientY;
      d.lastT = e.timeStamp;
      d.dy = dy;
    };

    const onEnd = () => {
      const drag = d;
      d = null;
      if (!drag?.dragging) return;
      const { sheet } = drag;
      const h = sheet.getBoundingClientRect().height;
      if (drag.dy > h * CLOSE_AT || (drag.v > FLICK && drag.dy > 12)) {
        settle(sheet, h + 24, 240);
        window.setTimeout(async () => {
          const closed = await closeSheet(sheet);
          if (!closed) {
            settle(sheet, 0, 380);
            window.setTimeout(() => release(sheet), 400);
          }
        }, 220);
      } else {
        settle(sheet, 0, 380);
        window.setTimeout(() => release(sheet), 400);
      }
    };

    const noop = () => {};
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    // iOS Safari only applies :active on a page with a touch listener.
    document.body.addEventListener("touchstart", noop, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      document.body.removeEventListener("touchstart", noop);
    };
  }, []);
  return null;
}
