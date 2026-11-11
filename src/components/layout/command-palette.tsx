"use client";

import { useRouter } from "@/components/layout/navigation-progress";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./command-palette.module.css";
import { CornerDownLeft, Search } from "lucide-react";
import { Overlay } from "@/components/ui/overlay";

/**
 * Jump to any page with ⌘K.
 *
 * <p>The portal design puts a search field at the top of the sidebar with a
 * ⌘K hint. This is what sits behind it.
 *
 * <p><b>Navigation only.</b> The design's palette also searches employees and
 * pay periods. Those need an endpoint that does not exist yet, and a search
 * box that silently fails to find a person somebody knows is in the system is
 * worse than one that never claimed to. The placeholder says "pages" so the
 * scope is stated rather than discovered.
 *
 * <p><b>It cannot reveal anything.</b> The destination list is filtered by
 * permission on the server before it is handed to this component, so the
 * palette can only offer pages the viewer could already reach from the nav.
 */

export type Destination = { label: string; href: string; group: string; detail?: string };

/**
 * The event the sidebar's search button fires to open the palette.
 *
 * <p>A window event rather than shared state: the button is inside the
 * sidebar and the palette is a sibling of it in the layout, so there is no
 * common React parent short of hoisting state into the server component,
 * which cannot hold it.
 */
export const OPEN_PALETTE_EVENT = "ta:open-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

/**
 * Subsequence match, the thing that makes a palette feel quick: "tmcd" finds
 * Timecards, "payper" finds Pay Periods. Consecutive hits and a match at the
 * start of a word score higher, so short exact prefixes beat long scattered
 * ones.
 */
export function score(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  const direct = t.indexOf(q);
  if (direct === 0) return 1000;
  if (direct > 0) return 600 - direct;

  let ti = 0;
  let points = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    const atWordStart = found === 0 || t[found - 1] === " " || t[found - 1] === "&";
    streak = found === ti ? streak + 1 : 0;
    points += 10 + streak * 5 + (atWordStart ? 15 : 0);
    ti = found + 1;
  }
  return points;
}

export function CommandPalette({ destinations }: { destinations: Destination[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const scored = destinations
      .map((d) => ({ d, s: Math.max(score(d.label, query), score(`${d.group} ${d.label}`, query) - 50) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12);
    return scored.map((r) => r.d);
  }, [destinations, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // ⌘K / Ctrl+K from anywhere. Registered once and kept for the session, so
  // the shortcut works on every page without each page knowing about it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) go(hit.href);
    }
  }

  return (
    <Overlay onMouseDown={close} className={`z-50 flex items-start justify-center px-4 pt-[12vh] ${styles.scrim}`}>
      {/* The shared window's materials (the grey frame, white raised cards,
          a quiet footer) at the top of the screen, where a search belongs:
          on a phone the keyboard opens at once and would cover a sheet. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className={styles.frame}
      >
        <div className={styles.field}>
          <Search className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search pages"
            aria-label="Search pages"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-row-${active}` : undefined}
            className="min-w-0 flex-1 border-0 bg-transparent outline-none"
            style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
          />
          <button type="button" className={styles.cancel} onClick={close}>
            Cancel
          </button>
        </div>

        <div ref={listRef} id="palette-results" role="listbox" aria-label="Pages" className={`ta-scroll ${styles.list}`}>
          {results.length === 0 ? (
            <p className={styles.empty}>No page matches “{query}”.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.href + r.label}
                id={`palette-row-${i}`}
                role="option"
                aria-selected={i === active}
                data-index={i}
                data-on={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.href)}
                className={styles.row}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={styles.rowLabel}>{r.label}</span>
                  {r.detail && <span className={styles.rowDetail}>{r.detail}</span>}
                </span>
                <span className={styles.rowGroup}>{r.group}</span>
                <CornerDownLeft className={`h-3.5 w-3.5 flex-none ${styles.enter}`} aria-hidden="true" />
              </button>
            ))
          )}
        </div>

        <p className={styles.foot}>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </p>
      </div>
    </Overlay>
  );
}
