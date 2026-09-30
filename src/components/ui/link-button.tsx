import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A Button that is actually a link.
 *
 * <p>Navigation has to stay an anchor: middle-click, ctrl-click, "open in new
 * tab" and the status-bar preview are all things people use on a row that
 * takes them to a timecard, and a button with an onClick router push has none
 * of them. This keeps the anchor and borrows the Button's look.
 *
 * <p>Same palette variables and the same .wms-btn rules, so hover and focus
 * behave identically to the real thing.
 */

type Hierarchy = "primary" | "secondary" | "tertiary" | "link";
type Size = "sm" | "md";

const SIZES: Record<Size, { height: number; padX: number; font: string }> = {
  sm: { height: 24, padX: 10, font: "var(--type-button2)" },
  md: { height: 32, padX: 12, font: "var(--type-button1)" },
};

export function LinkButton({
  href,
  children,
  hierarchy = "secondary",
  size = "md",
  leadingIcon,
  trailingIcon,
  title,
  reloadDocument = false,
}: {
  href: string;
  children: ReactNode;
  hierarchy?: Hierarchy;
  size?: Size;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  title?: string;
  /** Load the page fresh instead of moving in place, for a screen whose styles must not come along. */
  reloadDocument?: boolean;
}) {
  const s = SIZES[size];
  const isLink = hierarchy === "link";

  const palette: Record<string, string> =
    hierarchy === "primary"
      ? {
          "--bg": "var(--fill-accent)",
          "--bg-h": "var(--fill-accent-hover)",
          "--bg-a": "var(--fill-accent-pressed)",
          "--fg": "var(--text-on-accent)",
          "--fg-h": "var(--text-on-accent)",
          "--bd": "transparent",
        }
      : hierarchy === "secondary"
        ? {
            "--bg": "var(--surface-card)",
            "--bg-h": "var(--fill-hover)",
            "--bg-a": "var(--fill-pressed)",
            "--fg": "var(--text-primary)",
            "--fg-h": "var(--text-primary)",
            "--bd": "var(--stroke-default)",
          }
        : isLink
          ? {
              "--bg": "transparent",
              "--bg-h": "transparent",
              "--fg": "var(--link-accent)",
              "--fg-h": "var(--link-accent-hover)",
              "--bd": "transparent",
            }
          : {
              "--bg": "transparent",
              "--bg-h": "var(--fill-hover)",
              "--bg-a": "var(--fill-pressed)",
              "--fg": "var(--text-primary)",
              "--fg-h": "var(--text-primary)",
              "--bd": "transparent",
            };

  const Anchor = reloadDocument ? "a" : Link;

  return (
    <Anchor
      href={href}
      title={title}
      className={`wms-btn${isLink ? " wms-btn-link" : ""}`}
      style={{
        ...palette,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: isLink ? 20 : s.height,
        padding: isLink ? 0 : `0 ${s.padX}px`,
        border: "1px solid var(--bd)",
        borderRadius: "var(--radius-m)",
        font: s.font,
        whiteSpace: "nowrap",
        textDecoration: "none",
        boxShadow: hierarchy === "secondary" ? "0px 1px 2px rgba(0,0,0,0.05)" : "none",
      } as React.CSSProperties}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </Anchor>
  );
}
