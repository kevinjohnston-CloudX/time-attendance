"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * The design system's SegmentedControl: an enclosed switch for a small set of
 * mutually exclusive options.
 *
 * <p>Ported from components/navigation/SegmentedControl.jsx in the handoff
 * bundle — track heights, padding and the two palettes are the design's
 * numbers, not approximations. The interactive states are driven by per-segment
 * CSS variables and the shared `.wms-seg` rules in globals.css, which is the
 * same trick Button uses: the palette arrives as an inline style, and no
 * utility class can override an inline style.
 *
 * <p>This app filters lists through the URL — a filter that lives in React
 * state is lost on reload and cannot be linked to. So there are two of these:
 * {@link SegmentedControl} for a genuinely local choice, and
 * {@link SegmentedLinks} for anything that belongs in the query string.
 */

type Size = "sm" | "md";

const SIZES = {
  sm: { h: 24, seg: 20, pad: "2px 10px", font: "12px/16px" },
  md: { h: 32, seg: 28, pad: "4px 12px", font: "14px/20px" },
} as const;

const ON: CSSProperties = {
  ["--bg" as string]: "var(--surface-card)",
  ["--bg-h" as string]: "var(--surface-card)",
  ["--bg-a" as string]: "var(--surface-card)",
  ["--fg" as string]: "var(--text-primary)",
  ["--fg-h" as string]: "var(--text-primary)",
  ["--sh" as string]: "var(--shadow-xs)",
};

const OFF: CSSProperties = {
  ["--bg" as string]: "transparent",
  ["--bg-h" as string]: "var(--fill-hover)",
  ["--bg-a" as string]: "var(--fill-pressed)",
  ["--fg" as string]: "var(--text-secondary)",
  ["--fg-h" as string]: "var(--text-primary)",
  ["--sh" as string]: "none",
};

function trackStyle(size: Size, fullWidth: boolean): CSSProperties {
  return {
    display: fullWidth ? "flex" : "inline-flex",
    width: fullWidth ? "100%" : undefined,
    gap: 2,
    padding: 2,
    height: SIZES[size].h,
    boxSizing: "border-box",
    background: "var(--ta-track)",
    borderRadius: "var(--radius-m)",
  };
}

function segStyle(size: Size, active: boolean, fullWidth: boolean): CSSProperties {
  const s = SIZES[size];
  return {
    ...(active ? ON : OFF),
    flex: fullWidth ? "1 1 0" : "none",
    height: s.seg,
    padding: s.pad,
    border: "none",
    borderRadius: "var(--radius-s)",
    cursor: "pointer",
    font: `${active ? "var(--weight-semibold)" : "var(--weight-medium)"} ${s.font} var(--font-sans)`,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    textDecoration: "none",
  };
}

export interface SegmentItem {
  value: string;
  label: ReactNode;
  /** A count shown after the label, the way the design's approval tabs do. */
  count?: number;
}

/**
 * A local choice — a view toggle that nothing else on the page needs to know
 * about. If reloading the page should keep the choice, use SegmentedLinks.
 */
export function SegmentedControl({
  items,
  value,
  onChange,
  size = "md",
  fullWidth = false,
  ariaLabel,
}: {
  items: (SegmentItem | string)[];
  value: string;
  onChange: (next: string) => void;
  size?: Size;
  fullWidth?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={trackStyle(size, fullWidth)}>
      {items.map((raw) => {
        const it: SegmentItem = typeof raw === "string" ? { value: raw, label: raw } : raw;
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            className="wms-seg"
            aria-pressed={active}
            onClick={() => onChange(it.value)}
            style={segStyle(size, active, fullWidth)}
          >
            {it.label}
            {it.count !== undefined && <SegCount active={active}>{it.count}</SegCount>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same control, built from links.
 *
 * <p>Every list filter in this app is a query parameter, which is what makes a
 * filtered list shareable and survives a reload. Rendering the segments as
 * anchors keeps that: middle-click opens the filtered view in a tab, and the
 * server component re-runs the query rather than the client hiding rows it has
 * already fetched.
 */
export function SegmentedLinks({
  items,
  active,
  size = "md",
  fullWidth = false,
  ariaLabel,
}: {
  items: { href: string; label: ReactNode; value: string; count?: number }[];
  active: string;
  size?: Size;
  fullWidth?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={trackStyle(size, fullWidth)}>
      {items.map((it) => {
        const on = it.value === active;
        return (
          <Link
            key={it.value}
            href={it.href}
            scroll={false}
            className="wms-seg"
            aria-current={on ? "page" : undefined}
            style={segStyle(size, on, fullWidth)}
          >
            {it.label}
            {it.count !== undefined && <SegCount active={on}>{it.count}</SegCount>}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The count that rides along inside a segment.
 *
 * <p>Deliberately not the Badge component: a badge inside a 20px segment
 * overflows the track, and the count here is a weight on the label rather than
 * a status of its own.
 */
function SegCount({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      style={{
        fontVariantNumeric: "tabular-nums",
        fontWeight: "var(--weight-semibold)",
        color: active ? "var(--text-accent)" : "var(--text-tertiary)",
      }}
    >
      {children}
    </span>
  );
}
