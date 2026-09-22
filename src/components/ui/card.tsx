import type { CSSProperties, ReactNode } from "react";

/**
 * CloudX WMS Card — the base surface panel.
 *
 * <p>Hairline ring plus a soft ambient drop, from --shadow-card. The design
 * system is explicit that panels should read crisp and low-float rather than
 * heavy, which is why this is a shadow token and not a border.
 *
 * <p>Pass padding={0} when the card wraps a table: the table brings its own
 * cell padding and a padded card would inset it twice.
 */
export function Card({
  title,
  subtitle,
  actions,
  children,
  padding = 16,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  padding?: number;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-l)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid var(--stroke-divider)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            {title && <h3 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>{title}</h3>}
            {subtitle && (
              <p style={{ margin: 0, font: "var(--type-subtitle)", color: "var(--text-secondary)" }}>{subtitle}</p>
            )}
          </div>
          {actions && <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding }}>{children}</div>
    </section>
  );
}
