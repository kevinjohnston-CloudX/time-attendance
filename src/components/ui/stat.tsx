import type { ReactNode } from "react";

/**
 * A single figure on a card, as the portal design draws it: an uppercase
 * overline, the number under it, and an optional line of context.
 *
 * <p>The figure is always tabular. Stat cards are laid out in a row and read
 * as a set, and proportional digits make four numbers of the same magnitude
 * look like four different widths.
 *
 * <p>The tone is semantic rather than a colour, so "this number is a problem"
 * survives a palette change. Anything that is merely a count stays default —
 * colouring every figure is how a dashboard stops meaning anything.
 */

export type StatTone = "default" | "success" | "warning" | "error" | "accent";

const TONE_COLOR: Record<StatTone, string> = {
  default: "var(--text-primary)",
  success: "var(--text-success)",
  warning: "var(--text-warning)",
  error: "var(--text-error)",
  accent: "var(--text-accent)",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  children,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: StatTone;
  /** Anything that belongs under the figure — a badge row, an action. */
  children?: ReactNode;
}) {
  return (
    <div className="ta-card flex flex-col rounded-xl p-5">
      <p className="wms-overline">{label}</p>
      <p className="tabular mt-1.5" style={{ margin: 0, font: "var(--type-h2)", color: TONE_COLOR[tone] }}>
        {value}
      </p>
      {sub && (
        <p className="mt-1" style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
          {sub}
        </p>
      )}
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  );
}
