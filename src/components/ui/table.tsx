import type { CSSProperties, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

/**
 * CloudX WMS table primitives.
 *
 * <p>Deliberately elements rather than a columns/rows component. The tables
 * in this product are not uniform — timecards carry editable cells, exception
 * rows carry an action panel, punch history carries a source column with its
 * own rules — and a column-driven API would have every one of them passing
 * render functions that rebuild the markup anyway. Swapping table for Table
 * and td for TD is a change a reviewer can read.
 *
 * <p>Measurements from the design system's Table: 32px headers at 11px
 * uppercase on gray-75 (through --fill-hover, the semantic alias that is
 * gray-75 in light and follows dark mode), 40px rows, hairline dividers, no zebra striping, hover
 * on the row. Numeric columns are right-aligned with tabular figures, because
 * a column of hours is read down, not across.
 */

export function Table({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ overflow: "auto", ...style }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "max-content" }}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/**
 * The totals row at the bottom of a table.
 *
 * <p>Carries the header's fill and weight so it reads as a summary of the
 * column rather than another record in it — the distinction matters on an
 * hours report, where a totals line mistaken for an employee is a payroll
 * number that does not exist.
 */
export function TFoot({ children }: { children: ReactNode }) {
  return (
    <tfoot
      style={{
        background: "var(--fill-hover)",
        borderTop: "1px solid var(--stroke-secondary)",
      }}
    >
      {children}
    </tfoot>
  );
}

export function TR({
  children,
  onClick,
  selected = false,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  style?: CSSProperties;
}) {
  return (
    <tr
      onClick={onClick}
      className="ta-row"
      style={{
        cursor: onClick ? "pointer" : undefined,
        background: selected ? "var(--surface-info)" : undefined,
        ...style,
      }}
    >
      {children}
    </tr>
  );
}

interface CellProps {
  /** Right-align and use tabular figures. For anything you would add up. */
  numeric?: boolean;
  align?: "left" | "center" | "right";
}

export function TH({
  children,
  numeric = false,
  align,
  style,
  ...rest
}: CellProps & ThHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <th
      {...rest}
      style={{
        padding: "0 14px",
        height: 32,
        whiteSpace: "nowrap",
        font: "var(--weight-semibold) 11px/16px var(--font-sans)",
        letterSpacing: ".04em",
        textTransform: "uppercase",
        color: "var(--text-secondary)",
        background: "var(--fill-hover)",
        borderBottom: "1px solid var(--stroke-secondary)",
        position: "sticky",
        top: 0,
        zIndex: 1,
        textAlign: align ?? (numeric ? "right" : "left"),
        ...style,
      }}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  numeric = false,
  align,
  style,
  ...rest
}: CellProps & TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <td
      {...rest}
      style={{
        padding: "0 14px",
        height: 40,
        font: "var(--type-body1)",
        color: "var(--text-primary)",
        borderBottom: "1px solid var(--stroke-divider)",
        verticalAlign: "middle",
        textAlign: align ?? (numeric ? "right" : "left"),
        fontVariantNumeric: numeric ? "tabular-nums" : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

/**
 * The footer under a table: "Showing n of N".
 *
 * <p>The design's full TableFooter also carries a page-size select and a
 * pager. Neither is wired to anything here yet, and a pager that cannot turn
 * the page is worse than a count, so this is the count.
 */
export function TableFooter({ shown, total, label }: { shown: number; total: number; label: string }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2.5"
      style={{ borderTop: "1px solid var(--stroke-divider)", font: "var(--type-body2)", color: "var(--text-secondary)" }}
    >
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {shown === total ? `${total} ${label}` : `Showing ${shown} of ${total} ${label}`}
      </span>
    </div>
  );
}
