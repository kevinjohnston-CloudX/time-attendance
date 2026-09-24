import type { ReactNode, Ref } from "react";

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
  pinned = false,
  condensed = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Pin it to the top while the page scrolls. For a title alone; a page
   *  with filters under its title puts both in one PinnedBar instead. */
  pinned?: boolean;
  /** The slim form a pinned bar takes once the page has scrolled (see
   *  useCondensingBar): a smaller title and no subtitle. */
  condensed?: boolean;
}) {
  const header = (
    <div className={`flex flex-wrap gap-4 ${condensed ? "items-center" : "items-end"}`}>
      <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
        <h1
          style={{
            margin: 0,
            font: "var(--type-h1)",
            letterSpacing: "-0.02em",
            color: "var(--text-primary)",
            // Both sizes set every time: dropping a size set over the font
            // shorthand leaves the title with no size at all, not the full one.
            fontSize: condensed ? 20 : 30,
            lineHeight: condensed ? "26px" : "36px",
            transition: "font-size 140ms ease, line-height 140ms ease",
          }}
        >
          {title}
        </h1>
        {subtitle && !condensed && (
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
  return pinned ? <PinnedBar>{header}</PinnedBar> : header;
}

/**
 * The top of a page that stays put while the page scrolls: the title, the
 * page's actions and whatever filters sit under them, so none of it needs a
 * scroll back up to reach.
 *
 * <p>It must be the first thing in the page's column. It pulls itself up
 * into the layout's top padding so it already sits where it pins and never
 * slides on the first scroll, and out into the side padding so rows cannot
 * show through the gutters beside it. The layout's padding comes from
 * --pin-x and --pin-t, 16px unless a layout says otherwise.
 *
 * <p>Its bottom padding is taken back by a matching negative margin, so at
 * rest the page is spaced exactly as it was, and once pinned the rows sliding
 * under it still get a strip of clear space.
 */
export function PinnedBar({ children, barRef }: { children: ReactNode; barRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={barRef} className="ta-pinned flex flex-col gap-4">
      {children}
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
