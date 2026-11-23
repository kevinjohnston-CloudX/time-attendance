"use client";

import { useRef, useState } from "react";
import { MultiSelectWindow } from "@/components/payroll/multi-select-filter";

/**
 * A filter pill that takes several values, beside the single-value
 * FilterSelectChip and drawn the same: the label, what is picked once
 * something is, and an ✕ that clears it. A tap opens the list in a window,
 * with Select all and Clear, and a tick per row. Nothing picked is everybody;
 * every row picked is the same, so it is saved as nothing picked.
 */
export function FilterMultiChip({
  label,
  value,
  options,
  onChange,
  summary,
}: {
  label: string;
  /** The ids picked; empty for no filter. */
  value: readonly string[];
  options: { id: string; name: string }[];
  onChange: (ids: string[]) => void;
  /** What the pill says once some are picked. Defaults to the names, or how many. */
  summary?: (ids: readonly string[]) => string;
}) {
  // Open, and whether from inside a phone's Filters sheet, which the list
  // must be drawn above.
  const [open, setOpen] = useState<false | { raised: boolean }>(false);
  const pill = useRef<HTMLSpanElement>(null);
  const applied = value.length > 0;
  const names = options.filter((o) => value.includes(o.id)).map((o) => o.name);
  const text = !applied ? "" : summary ? summary(value) : names.length <= 2 && names.length > 0 ? names.join(", ") : `${value.length} selected`;

  return (
    <span
      ref={pill}
      className="ta-chip"
      data-applied={applied ? "true" : undefined}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 10px",
        boxSizing: "border-box",
        whiteSpace: "nowrap",
        maxWidth: "100%",
        borderRadius: 999,
        border: `1px solid ${applied ? "var(--stroke-accent)" : "var(--stroke-secondary)"}`,
        background: applied ? "var(--surface-info)" : "var(--surface-card)",
        font: "var(--type-body2)",
        fontWeight: "var(--weight-medium)",
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      {/* The whole pill opens the list; the ✕ sits above it. */}
      <button
        type="button"
        onClick={() => setOpen({ raised: !!pill.current?.closest(".ta-sheet") })}
        aria-haspopup="dialog"
        aria-label={applied ? `${label}: ${text}. Change` : `${label}: all. Pick some`}
        title={names.length > 2 ? names.join(", ") : undefined}
        style={{ position: "absolute", inset: 0, border: 0, padding: 0, background: "transparent", cursor: "pointer", borderRadius: 999 }}
      />
      <span>{label}</span>
      {/* Shown only in a phone's Filters sheet, as on FilterSelectChip. */}
      {!applied && <span className="ta-chip-none">All</span>}
      {applied && (
        <span className="truncate" style={{ minWidth: 0, maxWidth: 200, fontWeight: "var(--weight-semibold)", color: "var(--text-accent)" }}>
          {text}
        </span>
      )}
      {applied ? (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label={`Clear ${label} filter`}
          style={{
            position: "relative",
            zIndex: 1,
            display: "inline-flex",
            alignItems: "center",
            border: 0,
            padding: 0,
            background: "transparent",
            color: "var(--icon-tertiary)",
            cursor: "pointer",
            lineHeight: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : (
        <span style={{ display: "inline-flex", color: "var(--icon-tertiary)", lineHeight: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      )}
      {open && (
        <MultiSelectWindow
          label={label}
          options={options}
          value={[...value]}
          onApply={(ids) => onChange(ids.length === options.length ? [] : ids)}
          onClose={() => setOpen(false)}
          raised={open.raised}
        />
      )}
    </span>
  );
}
