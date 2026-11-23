"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * Layers drawn at the end of <body>, and the one rule for closing a panel on
 * a press outside it.
 *
 * <p>A dropdown's list, a date field's calendar, a menu and a pop up window
 * are drawn at the end of the page so nothing clips them, which puts them
 * outside the panel whose control opened them. A panel that closed on "a
 * press anywhere not inside me" took a press on one of them for a press
 * outside, and closed, taking the open list with it before the pick landed:
 * picking a Timecards filter did nothing (ticket 79224, Abby, Nov 22).
 *
 * <p>So every such layer is drawn through `floatingPortal`, which marks it,
 * and every panel that closes on an outside press does it through
 * `useOutsidePress`, which knows a press on a layer drawn over the panel is
 * not outside it. Both are enforced by eslint.config.mjs: `createPortal` and
 * a hand-written document "mousedown" or "pointerdown" listener are refused
 * everywhere else, so a new dropdown, menu or panel cannot bring it back.
 */

/** The attribute that marks an element drawn at the end of the page. */
export const FLOATING_LAYER = "data-floating-layer";

/**
 * `children` drawn at the end of <body>, marked as a floating layer. The
 * wrapper draws no box of its own (display: contents), so the children lay
 * out and position exactly as they would without it. React events and
 * context still reach it as if it sat where it is written.
 */
export function floatingPortal(children: ReactNode, key?: string) {
  return createPortal(
    <div {...{ [FLOATING_LAYER]: "" }} style={{ display: "contents" }}>
      {children}
    </div>,
    document.body,
    key,
  );
}

type Inside = Element | null | undefined;

/**
 * Whether a press landed outside a panel made of the `inside` elements (its
 * button and its panel, say). A press on a floating layer is not outside it
 * unless that layer is the one the panel itself sits in: a dropdown's list or
 * a window drawn over the panel belongs to it, while a press elsewhere in the
 * window that holds the panel is a press outside the panel.
 */
export function pressedOutside(target: EventTarget | null, inside: Inside[]): boolean {
  if (!(target instanceof Node)) return false;
  // A press that has already been taken off the page counts for nothing.
  if (!target.isConnected) return false;
  if (inside.some((el) => el?.contains(target))) return false;
  const from = target instanceof Element ? target : target.parentElement;
  const layer = from?.closest(`[${FLOATING_LAYER}]`);
  if (layer && !inside.some((el) => el && layer.contains(el))) return false;
  return true;
}

/**
 * Keeps a press on a floating layer (a dropdown's list, a date's calendar)
 * to the layer: caught on the window before anything on the page hears it,
 * so not even a listener written by hand can take it for a press outside its
 * panel. The mouse press is held back too, so the field that opened the
 * layer keeps the focus and the keys. Clicks still reach the layer's buttons.
 */
export function useOwnPresses(layer: RefObject<Element | null>) {
  useEffect(() => {
    const keep = (e: Event) => {
      if (!(e.target instanceof Node) || !layer.current?.contains(e.target)) return;
      if (e.type === "mousedown") e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("pointerdown", keep, true);
    window.addEventListener("mousedown", keep, true);
    return () => {
      window.removeEventListener("pointerdown", keep, true);
      window.removeEventListener("mousedown", keep, true);
    };
  }, [layer]);
}

/**
 * Calls `onOutside` on a press outside the panel while `open` is true, and on
 * Escape when `escape` is set. `inside` lists the panel's own elements: its
 * button and its panel, which may itself be a floating layer.
 */
export function useOutsidePress({
  open,
  inside,
  onOutside,
  escape = false,
}: {
  open: boolean;
  inside: RefObject<Element | null>[];
  onOutside: () => void;
  escape?: boolean;
}) {
  // Read at the moment of the press, so a caller need not keep these stable.
  const latest = useRef({ inside, onOutside });
  useEffect(() => {
    latest.current = { inside, onOutside };
  });

  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      const { inside: refs, onOutside: close } = latest.current;
      if (pressedOutside(e.target, refs.map((r) => r.current))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current.onOutside();
    };
    document.addEventListener("pointerdown", onPress);
    if (escape) document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      if (escape) document.removeEventListener("keydown", onKey);
    };
  }, [open, escape]);
}
