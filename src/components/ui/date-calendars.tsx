"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { isPhone } from "@/lib/phone";
import menu from "./menu.module.css";
import styles from "./date-calendars.module.css";

/**
 * Every date field's calendar, drawn by CloudTime on a computer.
 *
 * <p>Mounted once for the whole app, beside the dropdown lists. A date field
 * stays a real `<input type="date">`: typing a date into it works as before,
 * and so do its value, its form field, its min and max, and every caller's
 * onChange. Only the calendar it opens is ours, on the shared menu's look,
 * instead of the browser's.
 *
 * <p>A click in the field opens it, and so does Alt with the down arrow,
 * which also lets the arrows move between days. A click on a day, or Enter,
 * sets the date; Today and Clear sit at the foot (Clear only where the date
 * may be left empty). Days outside the field's min and max cannot be picked.
 * Escape closes it before a window underneath hears the key.
 *
 * <p>On a phone, and for any touch, the device's own date picker opens as
 * before (agreed with Juan). `data-native-date` on an element keeps the
 * browser's calendar for the date fields inside it.
 */

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const GAP = 4;
const EDGE = 8;
const HEIGHT = 360;

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => {
  const t = new Date();
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate());
};
/** "2026-11-11" as a year, a month from 0 and a day; null for anything else. */
function parts(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return hit ? { y: Number(hit[1]), m: Number(hit[2]) - 1, d: Number(hit[3]) } : null;
}
/** A day moved by some days, in plain calendar arithmetic. */
function shift(iso: string, days: number): string {
  const p = parts(iso)!;
  const d = new Date(p.y, p.m, p.d + days);
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The date field a press or a key belongs to, when its calendar is ours. */
function ours(target: EventTarget | null): HTMLInputElement | null {
  const el = target as HTMLInputElement | null;
  if (!(el instanceof HTMLInputElement) || el.type !== "date") return null;
  if (el.disabled || el.readOnly || el.closest("[data-native-date]")) return null;
  return isPhone() ? null : el;
}

type Place = { top: number; left: number; up: boolean };

function placeFor(el: HTMLElement): Place {
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - GAP - EDGE;
  const up = below < HEIGHT && r.top - GAP - EDGE > below;
  return { top: up ? r.top - GAP : r.bottom + GAP, left: Math.min(r.left, window.innerWidth - 300 - EDGE), up };
}

/** Sets the field as a person typing it would, so React's onChange runs. */
function write(el: HTMLInputElement, iso: string) {
  if (el.value === iso) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, iso);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function DateCalendars() {
  const [field, setField] = useState<HTMLInputElement | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  /** The month on screen, as its first day. */
  const [month, setMonth] = useState<{ y: number; m: number }>({ y: 2000, m: 0 });
  /** The field's date, kept in step while somebody types. */
  const [value, setValue] = useState("");
  /** The day the arrows are on, once the keys are driving. */
  const [cursor, setCursor] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef("mouse");
  const state = useRef({ field, cursor, month });
  useEffect(() => {
    state.current = { field, cursor, month };
  }, [field, cursor, month]);

  const close = useCallback((refocus: boolean) => {
    const el = state.current.field;
    if (!el) return;
    el.removeAttribute("aria-expanded");
    if (refocus && el.isConnected) el.focus({ preventScroll: true });
    setField(null);
    setPlace(null);
    setCursor(null);
  }, []);

  const open = useCallback((el: HTMLInputElement, byKeys: boolean) => {
    const start = parts(el.value) ?? parts(clampIso(todayIso(), el.min, el.max))!;
    el.setAttribute("aria-expanded", "true");
    setValue(el.value);
    setMonth({ y: start.y, m: start.m });
    setCursor(byKeys ? (el.value || clampIso(todayIso(), el.min, el.max)) : null);
    setPlace(placeFor(el));
    setField(el);
  }, []);

  const pick = useCallback(
    (iso: string) => {
      const el = state.current.field;
      if (!el) return;
      write(el, iso);
      close(true);
    },
    [close],
  );

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
    };
    // A press outside the calendar and its field closes it.
    const onDown = (e: MouseEvent) => {
      const el = state.current.field;
      if (!el) return;
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || t === el) return;
      close(false);
    };
    // A click in the field opens ours; the browser's own is held back.
    const onClick = (e: MouseEvent) => {
      if (lastPointer.current === "touch" || lastPointer.current === "pen") return;
      const el = ours(e.target);
      if (!el) return;
      e.preventDefault();
      if (state.current.field !== el) open(el, false);
    };
    const onKey = (e: KeyboardEvent) => {
      const { field: el, cursor: at, month: shown } = state.current;
      if (!el) {
        if (e.key !== "ArrowDown" || !e.altKey) return;
        const target = ours(e.target);
        if (!target) return;
        e.preventDefault();
        open(target, true);
        return;
      }
      if (e.key === "Escape") {
        close(true);
        e.preventDefault();
        // Before a window underneath hears it and closes too.
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === "Tab") {
        close(false);
        return;
      }
      // Without Alt and the arrow, the keys are for typing into the field.
      if (at === null) return;
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      let next: string | null = null;
      if (e.key in moves) next = shift(at, moves[e.key]);
      else if (e.key === "PageUp" || e.key === "PageDown") {
        const p = parts(at)!;
        const d = new Date(p.y, p.m + (e.key === "PageUp" ? -1 : 1), 1);
        next = isoOf(d.getFullYear(), d.getMonth(), Math.min(p.d, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      } else if (e.key === "Enter" || e.key === " ") {
        if (inRange(at, el.min, el.max)) pick(at);
        e.preventDefault();
        e.stopPropagation();
        return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      const p = parts(next)!;
      setCursor(next);
      if (p.y !== shown.y || p.m !== shown.m) setMonth({ y: p.y, m: p.m });
    };
    // Typing a date moves the calendar to it.
    const onInput = (e: Event) => {
      const el = state.current.field;
      if (!el || e.target !== el) return;
      setValue(el.value);
      const p = parts(el.value);
      if (p) setMonth({ y: p.y, m: p.m });
    };
    const onScroll = (e: Event) => {
      if (state.current.field && !panelRef.current?.contains(e.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("input", onInput, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, pick]);

  // Kept inside the window once its size is known.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !place) return;
    const box = panel.getBoundingClientRect();
    if (box.left < EDGE) panel.style.left = `${EDGE}px`;
  }, [place]);

  if (!field || !place) return null;

  const today = todayIso();
  const first = new Date(month.y, month.m, 1);
  const gridStart = new Date(month.y, month.m, 1 - first.getDay());
  const daysIn = new Date(month.y, month.m + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysIn) / 7);
  const min = field.min;
  const max = field.max;
  const prevOk = !min || isoOf(month.y, month.m, 1) > min;
  const nextOk = !max || isoOf(month.y, month.m, daysIn) < max;
  const goMonth = (by: number) => {
    const d = new Date(month.y, month.m + by, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const label = field.getAttribute("aria-label") ?? field.labels?.[0]?.textContent ?? "Date";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${label}, calendar`}
      className={`${menu.panel} ${styles.panel}`}
      data-up={place.up || undefined}
      style={{ top: place.top, left: place.left }}
      // The field keeps focus, so typing and the keys stay with it.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className={styles.head}>
        <button type="button" className={`ta-hoverable ${styles.nav}`} aria-label="Previous month" disabled={!prevOk} onClick={() => goMonth(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <span className={styles.month} aria-live="polite">
          {MONTHS[month.m]} {month.y}
        </span>
        <button type="button" className={`ta-hoverable ${styles.nav}`} aria-label="Next month" disabled={!nextOk} onClick={() => goMonth(1)}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      <div className={styles.grid} role="grid">
        {DOW.map((d) => (
          <span key={d} className={styles.dow} aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
          const iso = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
          const ok = inRange(iso, min, max);
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              tabIndex={-1}
              className={`tabular ${styles.day}`}
              disabled={!ok}
              aria-selected={iso === value || undefined}
              aria-current={iso === today ? "date" : undefined}
              data-outside={d.getMonth() !== month.m || undefined}
              data-cursor={iso === cursor || undefined}
              aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              onClick={() => pick(iso)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      <div className={styles.foot}>
        <button type="button" className={`ta-hoverable ${styles.footBtn}`} disabled={!inRange(today, min, max)} onClick={() => pick(today)}>
          Today
        </button>
        {!field.required && value && (
          <button type="button" className={`ta-hoverable ${styles.footBtn}`} onClick={() => pick("")}>
            Clear
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function inRange(iso: string, min: string, max: string): boolean {
  return (!min || iso >= min) && (!max || iso <= max);
}

function clampIso(iso: string, min: string, max: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}
