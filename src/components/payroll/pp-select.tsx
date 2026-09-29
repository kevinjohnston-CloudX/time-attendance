"use client";

import { ChevronDown } from "lucide-react";

/**
 * The Pay Periods handoff's filter trigger ("All sites ⌄"): a bordered pill
 * with the value in bold, accent once something is picked.
 *
 * <p>The browser's own list opens under it, a native select laid invisibly
 * over the pill, as on the Audit Log: it works with the keyboard, a screen
 * reader and a phone without a menu of our own to get wrong.
 */
export function PpSelect({
  label,
  value,
  options,
  onChange,
  maxWidth = 200,
}: {
  /** What the list chooses, for a screen reader ("Site"). */
  label: string;
  value: string;
  /** The first option is the "all" choice, with value "". */
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  maxWidth?: number;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const active = value !== "";
  return (
    <span
      className="relative inline-flex h-8 flex-none items-center gap-1.5 whitespace-nowrap px-2.5 transition-shadow [box-shadow:0_0_0_1px_var(--ta-ring-strong)] hover:[box-shadow:0_0_0_1px_var(--stroke-default)] focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--stroke-accent-focus)] focus-within:[outline-style:solid]"
      style={{ borderRadius: 9, background: "var(--surface-card)" }}
    >
      <b className="truncate" style={{ maxWidth, font: "var(--weight-semibold) 13px/1 var(--font-sans)", color: active ? "var(--text-accent)" : "var(--text-primary)" }}>
        {current?.label}
      </b>
      <ChevronDown className="h-3.5 w-3.5 flex-none" aria-hidden style={{ color: "var(--icon-secondary)" }} />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
