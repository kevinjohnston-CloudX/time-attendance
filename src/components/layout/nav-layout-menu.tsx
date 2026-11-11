"use client";

import { useEffect, useRef, useState } from "react";
import { Check, PanelLeft } from "lucide-react";
import { navModeStore, useNavMode, type NavMode } from "./nav-mode";
import styles from "./notification-bell.module.css";

const LAYOUTS: { value: NavMode; title: string }[] = [
  { value: "grouped", title: "Grouped" },
  { value: "rail", title: "Rail" },
];

/**
 * The navigation layout, as one round button in the top bar's icon pill. It
 * used to be a "Nav" label and a Grouped/Rail switch on the bar itself, which
 * kept a setting people change once on screen all day. The menu draws each
 * layout as a small sketch of the sidebar it gives, so "Rail" never has to
 * be guessed at.
 */
export function NavLayoutMenu() {
  const mode = useNavMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Navigation layout"
        aria-label="Navigation layout"
        aria-haspopup="menu"
        aria-expanded={open}
        className="ta-pill-btn grid h-7 w-7 flex-none place-items-center rounded-full"
        style={{ color: open ? "var(--icon-accent)" : "var(--icon-tertiary)" }}
      >
        <PanelLeft className="h-4 w-4" />
      </button>

      {/* Anchored to the icon pill, like the bell's list. */}
      {open && (
        <div
          role="menu"
          aria-label="Navigation layout"
          className={`absolute right-0 top-[calc(100%+8px)] z-50 w-[196px] rounded-[14px] p-1.5 ${styles.panel}`}
          style={{ background: "var(--surface-card)", boxShadow: "var(--ta-drop-shadow)" }}
        >
          <p
            className="px-2.5 pb-1.5 pt-2"
            style={{ margin: 0, font: "var(--weight-semibold) 12px/16px var(--font-sans)", color: "var(--text-tertiary)" }}
          >
            Navigation layout
          </p>
          {LAYOUTS.map((l) => {
            const on = l.value === mode;
            return (
              <button
                key={l.value}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  navModeStore.set(l.value);
                  setOpen(false);
                }}
                className="ta-pill-btn flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left"
                style={on ? { background: "var(--ta-choice-on)" } : undefined}
              >
                <LayoutSketch layout={l.value} on={on} />
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    font: "var(--weight-semibold) 13px/18px var(--font-sans)",
                    color: on ? "var(--text-accent)" : "var(--text-primary)",
                  }}
                >
                  {l.title}
                </span>
                <Check
                  className="h-4 w-4 flex-none"
                  style={{ color: "var(--icon-accent)", visibility: on ? "visible" : "hidden" }}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The window in miniature, showing only what changes: the left side. Grouped
 * is one sidebar of icons with names. Rail is a solid strip of icons with the
 * section's pages listed beside it. Big blocks and few of them, so the
 * difference reads at a glance at this size.
 */
function LayoutSketch({ layout, on }: { layout: NavMode; on: boolean }) {
  const tone = on ? "var(--surface-info)" : "var(--surface-secondary)";
  const edge = on ? "var(--stroke-accent-focus)" : "var(--stroke-default)";
  const mark = on ? "var(--fill-accent)" : "var(--icon-tertiary)";
  const rows = [10, 17, 24, 31];
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" aria-hidden className="flex-none">
      <rect x="0.75" y="0.75" width="62.5" height="42.5" rx="7" fill="var(--surface-card)" stroke={edge} strokeWidth="1.5" />
      {layout === "grouped" ? (
        <>
          {/* One sidebar: an icon and a name on every row. */}
          <rect x="4.5" y="4.5" width="25" height="35" rx="4" fill={tone} stroke={edge} />
          {rows.map((y) => (
            <g key={y}>
              <rect x="8" y={y} width="4" height="4" rx="1.2" fill={mark} />
              <rect x="14" y={y + 0.5} width="12" height="3" rx="1.5" fill={mark} />
            </g>
          ))}
        </>
      ) : (
        <>
          {/* A solid strip of icons, with the section's pages beside it. */}
          <rect x="4.5" y="4.5" width="9" height="35" rx="4" fill={mark} />
          {rows.map((y) => (
            <rect key={y} x="7" y={y} width="4" height="4" rx="1.2" fill="var(--surface-card)" />
          ))}
          <rect x="16.5" y="4.5" width="17" height="35" rx="4" fill={tone} stroke={edge} />
          {rows.map((y) => (
            <rect key={y} x="20" y={y + 0.5} width="10" height="3" rx="1.5" fill={mark} />
          ))}
        </>
      )}
    </svg>
  );
}
