import type { ReactNode } from "react";
import { AlertOctagon, AlertCircle, CheckCircle2, Info } from "lucide-react";

/**
 * CloudX WMS Banner — an inline status message at the top of a page or panel.
 *
 * <p>Ported from components/feedback/Banner.jsx. The tone locks the icon and
 * the colours together, which is the point: the same class of message reads
 * the same everywhere, so "this timesheet is locked" never arrives looking
 * like a confirmation.
 *
 * <p>There is no dismiss control, deliberately. A banner describes a state —
 * the state changing is what removes it. A dismissible "your timesheet was
 * returned" would let someone close the only notice that the period is not
 * done.
 */

export type BannerTone = "error" | "warning" | "info" | "success";

const TONES: Record<
  BannerTone,
  { surface: string; stroke: string; rule: string; icon: string; title: string; Icon: typeof Info }
> = {
  error: {
    surface: "var(--surface-error)",
    stroke: "var(--stroke-error)",
    rule: "var(--fill-error)",
    icon: "var(--icon-error)",
    title: "var(--text-error)",
    Icon: AlertOctagon,
  },
  warning: {
    surface: "var(--surface-warning)",
    stroke: "var(--stroke-warning)",
    rule: "var(--fill-warning)",
    icon: "var(--icon-warning)",
    title: "var(--text-warning)",
    Icon: AlertCircle,
  },
  info: {
    surface: "var(--surface-info)",
    stroke: "var(--stroke-accent-focus)",
    rule: "var(--fill-accent)",
    icon: "var(--icon-accent)",
    title: "var(--text-accent)",
    Icon: Info,
  },
  success: {
    surface: "var(--surface-success)",
    stroke: "var(--stroke-success)",
    rule: "var(--fill-success)",
    icon: "var(--icon-success)",
    title: "var(--text-success)",
    Icon: CheckCircle2,
  },
};

export function Banner({
  tone = "warning",
  title,
  body,
  meta,
  actions,
  children,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  body?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const t = TONES[tone] ?? TONES.warning;
  const Icon = t.Icon;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "stretch",
        background: t.surface,
        border: `1px solid ${t.stroke}`,
        borderLeft: "none",
        // Square on the rule side, rounded on the other three — the shape the
        // design system uses to make the colour bar read as part of the panel.
        borderRadius: "var(--radius-s) var(--radius-l) var(--radius-l) var(--radius-s)",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <span aria-hidden="true" style={{ flex: "none", width: 4, alignSelf: "stretch", background: t.rule }} />
      <div className="flex flex-1 flex-wrap items-center gap-3 px-3.5 py-3">
        <Icon className="h-[18px] w-[18px] flex-none self-start" style={{ color: t.icon }} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title && (
            <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: t.title }}>
              {title}
            </span>
          )}
          {body && (
            <span style={{ font: "var(--type-body1)", color: "var(--text-primary)", textWrap: "pretty" }}>
              {body}
            </span>
          )}
          {children}
          {meta && (
            <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{meta}</span>
          )}
        </div>
        {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
