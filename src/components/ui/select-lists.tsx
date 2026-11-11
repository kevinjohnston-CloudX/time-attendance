"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { isPhone } from "@/lib/phone";
import menu from "./menu.module.css";
import styles from "./select-lists.module.css";

/**
 * Every dropdown's list, drawn by CloudTime on a computer.
 *
 * <p>Mounted once for the whole app. A dropdown stays a real `<select>`, so
 * its value, its form field and every caller's onChange work as before; only
 * the list it opens is ours, on the shared menu's look, instead of the
 * browser's grey one. That covers the Select fields, the filter and sort
 * pills (an invisible select laid over the pill) and the plain selects in
 * one place, so no dropdown can be missed or drift from the rest.
 *
 * <p>On a phone, and for any touch, the device's own picker opens as before:
 * it is larger, made for a thumb, and the app and the phone site stay alike.
 * A select can keep the browser's list on a computer too, from inside an
 * element marked `data-native-select`.
 *
 * <p>The list opens on a click, or on Space, Enter or an arrow key while the
 * select has focus. The arrows move, Enter or a click picks, typing jumps to
 * the option that starts with the letters, and Escape closes it without
 * closing a window underneath. Scrolling the page or resizing it closes it.
 */

type Row =
  | { kind: "group"; key: string; label: string }
  | { kind: "option"; key: string; index: number; label: string; disabled: boolean };

function rowsOf(sel: HTMLSelectElement): Row[] {
  const rows: Row[] = [];
  const add = (o: HTMLOptionElement, groupOff: boolean) => {
    if (o.hidden) return;
    rows.push({ kind: "option", key: `o${o.index}`, index: o.index, label: o.label || o.text, disabled: o.disabled || groupOff });
  };
  Array.from(sel.children).forEach((child, i) => {
    if (child instanceof HTMLOptGroupElement) {
      rows.push({ kind: "group", key: `g${i}`, label: child.label });
      Array.from(child.children).forEach((o) => o instanceof HTMLOptionElement && add(o, child.disabled));
    } else if (child instanceof HTMLOptionElement) {
      add(child, false);
    }
  });
  return rows;
}

/** The select a press or a key belongs to, when its list is ours to draw. */
function ours(target: EventTarget | null): HTMLSelectElement | null {
  const sel = (target as Element | null)?.closest?.("select");
  if (!(sel instanceof HTMLSelectElement)) return null;
  if (sel.multiple || sel.size > 1 || sel.disabled || sel.closest("[data-native-select]")) return null;
  return isPhone() ? null : sel;
}

const OPEN_KEYS = new Set([" ", "Enter", "ArrowDown", "ArrowUp"]);
const GAP = 4;
const EDGE = 8;

type Place = { top: number; left: number; minWidth: number; maxHeight: number; up: boolean };

/** Under the select, or over it when there is more room above; never past an
 *  edge of the window. */
function placeFor(sel: HTMLSelectElement): Place {
  const r = sel.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const up = below < 220 && above > below;
  return {
    top: up ? r.top - GAP : r.bottom + GAP,
    left: r.left,
    minWidth: Math.max(r.width, 160),
    maxHeight: Math.min(340, Math.max(up ? above : below, 120)),
    up,
  };
}

export function SelectLists() {
  const listId = useId();
  const [sel, setSel] = useState<HTMLSelectElement | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Place | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<string>("mouse");
  const typed = useRef({ text: "", at: 0 });
  // The handlers below are registered once, so they read the open list here.
  const state = useRef({ sel, rows, active });
  useEffect(() => {
    state.current = { sel, rows, active };
  }, [sel, rows, active]);

  const close = useCallback((refocus: boolean) => {
    const s = state.current.sel;
    if (!s) return;
    s.removeAttribute("aria-expanded");
    s.removeAttribute("aria-controls");
    if (refocus && s.isConnected) s.focus({ preventScroll: true });
    setSel(null);
    setPlace(null);
  }, []);

  const open = useCallback(
    (s: HTMLSelectElement) => {
      s.focus({ preventScroll: true });
      s.setAttribute("aria-expanded", "true");
      s.setAttribute("aria-controls", listId);
      typed.current = { text: "", at: 0 };
      setPlace(placeFor(s));
      setRows(rowsOf(s));
      setActive(s.selectedIndex);
      setSel(s);
    },
    [listId],
  );

  const pick = useCallback(
    (index: number) => {
      const s = state.current.sel;
      if (!s) return;
      const changed = s.selectedIndex !== index;
      close(true);
      if (!changed) return;
      s.selectedIndex = index;
      // React hears a select's change event, so every caller's onChange runs
      // with this select as its target, exactly as a native pick would.
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [close],
  );

  // Opening: a click, or a key on a focused select.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
    };
    const onMouseDown = (e: MouseEvent) => {
      const { sel: openSel } = state.current;
      const target = e.target as Node;
      if (openSel) {
        if (listRef.current?.contains(target)) return;
        const again = ours(e.target) === openSel;
        close(again);
        // A second press on the same select closes its list, as the browser's does.
        if (again) e.preventDefault();
        return;
      }
      if (e.button !== 0 || lastPointer.current === "touch" || lastPointer.current === "pen") return;
      const s = ours(e.target);
      if (!s) return;
      e.preventDefault();
      open(s);
    };
    const onKey = (e: KeyboardEvent) => {
      const { sel: openSel, rows: openRows, active: at } = state.current;
      if (!openSel) {
        if (!OPEN_KEYS.has(e.key) || e.metaKey || e.ctrlKey) return;
        const s = ours(document.activeElement);
        if (!s || s !== e.target) return;
        e.preventDefault();
        open(s);
        return;
      }
      const options = openRows.filter((r): r is Extract<Row, { kind: "option" }> => r.kind === "option" && !r.disabled);
      const pos = options.findIndex((o) => o.index === at);
      const move = (to: number) => {
        const o = options[Math.max(0, Math.min(options.length - 1, to))];
        if (o) setActive(o.index);
      };
      switch (e.key) {
        case "ArrowDown":
          move(pos < 0 ? 0 : pos + 1);
          break;
        case "ArrowUp":
          move(pos < 0 ? 0 : pos - 1);
          break;
        case "Home":
        case "PageUp":
          move(e.key === "Home" ? 0 : pos - 8);
          break;
        case "End":
        case "PageDown":
          move(e.key === "End" ? options.length - 1 : pos + 8);
          break;
        case "Enter":
        case " ":
          if (at >= 0) pick(at);
          else close(true);
          break;
        case "Escape":
          close(true);
          // Before a window underneath hears it and closes too.
          e.stopImmediatePropagation();
          break;
        case "Tab":
          close(false);
          return;
        default: {
          if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
          // Typing jumps to the first option that starts with the letters.
          const now = Date.now();
          const text = (now - typed.current.at > 700 ? "" : typed.current.text) + e.key.toLowerCase();
          typed.current = { text, at: now };
          const from = text.length === 1 ? pos + 1 : Math.max(pos, 0);
          const ordered = [...options.slice(from), ...options.slice(0, from)];
          const hit = ordered.find((o) => o.label.toLowerCase().startsWith(text));
          if (hit) setActive(hit.index);
        }
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const onScroll = (e: Event) => {
      if (state.current.sel && !listRef.current?.contains(e.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, pick]);

  // Kept inside the window once its width is known, with the chosen option in view.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !place) return;
    const box = list.getBoundingClientRect();
    const over = box.right - (window.innerWidth - EDGE);
    if (over > 0) list.style.left = `${Math.max(EDGE, place.left - over)}px`;
    // The chosen option, with its group's label when it is the first in it.
    const on = list.querySelector<HTMLElement>('[aria-selected="true"]');
    const label = on?.previousElementSibling?.getAttribute("role") === "presentation" ? on.previousElementSibling : null;
    (label ?? on)?.scrollIntoView({ block: "nearest" });
  }, [place]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!sel || !place) return null;
  const chosen = sel.selectedIndex;

  return createPortal(
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={sel.getAttribute("aria-label") ?? sel.labels?.[0]?.textContent ?? undefined}
      className={`ta-scroll ${menu.panel} ${styles.list}`}
      data-up={place.up || undefined}
      style={{ top: place.top, left: place.left, minWidth: place.minWidth, maxHeight: place.maxHeight }}
      // The select keeps focus, so the keys stay with it.
      onMouseDown={(e) => e.preventDefault()}
    >
      {rows.map((r) =>
        r.kind === "group" ? (
          <div key={r.key} className={menu.label} role="presentation">
            {r.label}
          </div>
        ) : (
          <div
            key={r.key}
            id={`${listId}-${r.index}`}
            role="option"
            aria-selected={r.index === active}
            aria-disabled={r.disabled || undefined}
            data-chosen={r.index === chosen || undefined}
            className={menu.option}
            onMouseMove={() => !r.disabled && r.index !== active && setActive(r.index)}
            onClick={() => !r.disabled && pick(r.index)}
          >
            <span className={styles.text}>{r.label}</span>
            {r.index === chosen && <Check className={menu.optionCheck} aria-hidden="true" />}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}
