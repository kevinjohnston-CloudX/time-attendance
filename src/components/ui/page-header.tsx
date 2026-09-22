import type { ReactNode } from "react";

/**
 * Page title, one line of context, and the page-level actions.
 *
 * <p>From the portal design, which gives every screen the same opening: an
 * h1 at 30px with a -0.02em tuck, a secondary line underneath that says which
 * pay period or which site you are looking at, and the actions pushed right.
 *
 * <p>The subtitle is not decoration. On a screen full of hours, the thing
 * that makes a number wrong is usually the period it belongs to, and that was
 * previously only visible by reading a filter control.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
        <h1 style={{ margin: 0, font: "var(--type-h1)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          {title}
        </h1>
        {subtitle && <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * What a list shows when a filter matches nothing.
 *
 * <p>Deliberately says which of the two it is. "No exceptions" after
 * filtering to one department reads as "this team is clean" when it actually
 * means "nothing matched", and someone closes a pay period on the strength of
 * it.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
      {icon && <span style={{ color: "var(--icon-disabled)" }}>{icon}</span>}
      <div style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>{title}</div>
      {body && (
        <div style={{ font: "var(--type-body1)", color: "var(--text-secondary)", maxWidth: 380 }}>{body}</div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
