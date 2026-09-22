import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The list-screen toolbar from the portal design.
 *
 * <p>Every list in the design opens the same way: a row of view segments and a
 * search box, the record count pushed right, and under it the filters that are
 * actually applied, as pills you can clear one at a time. The parts are
 * separate components because no two screens filter by the same things — what
 * is shared is the shape, not the contents.
 *
 * <p>All of it is server-renderable. The filters in this app live in the query
 * string, so a chip is a link that drops one parameter, not a click handler
 * that mutates state the URL never hears about.
 */

/**
 * The toolbar's first row: controls on the left, count on the right.
 *
 * <p>The count is not decoration. "No exceptions" and "no exceptions matching
 * these three filters" look identical without it, and the difference decides
 * whether someone closes a pay period.
 */
export function Toolbar({
  children,
  count,
  countLabel = "record",
}: {
  children?: ReactNode;
  count?: number;
  countLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {children}
      <div className="flex-1" />
      {count !== undefined && (
        <span
          className="tabular"
          style={{ font: "var(--type-body2)", color: "var(--text-tertiary)", whiteSpace: "nowrap" }}
        >
          {count} {count === 1 ? countLabel : `${countLabel}s`}
        </span>
      )}
    </div>
  );
}

/**
 * The second row: which filters are on, and how to take them off.
 *
 * <p>Renders nothing when no chip is passed, so a page can hand it a list that
 * is empty on the unfiltered view without guarding the call itself.
 */
export function FilterBar({ children, clearHref }: { children?: ReactNode; clearHref?: string }) {
  const chips = Array.isArray(children) ? children.filter(Boolean) : children;
  if (!chips || (Array.isArray(chips) && chips.length === 0)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips}
      {clearHref && (
        <Link
          href={clearHref}
          scroll={false}
          className="wms-btn wms-btn-link"
          style={{
            background: "transparent",
            color: "var(--text-accent)",
            font: "var(--type-button2)",
            padding: "0 2px",
          }}
        >
          Clear all
        </Link>
      )}
    </div>
  );
}

/**
 * One applied filter.
 *
 * <p>Two states, both from the design: unset is a hairline pill with the field
 * name; set turns the value accent-coloured and grows an ✕ that links back to
 * the same page without that parameter. The ✕ is the whole point — a filter
 * you cannot see is a filter you cannot take off, which is how a supervisor
 * ends up certain a department has no exceptions.
 */
export function FilterChip({
  label,
  value,
  clearHref,
  icon,
}: {
  label: string;
  value?: string | null;
  clearHref?: string;
  icon?: ReactNode;
}) {
  const applied = value != null && value !== "";
  return (
    <span
      className="ta-chip"
      data-applied={applied ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 10px",
        boxSizing: "border-box",
        whiteSpace: "nowrap",
        borderRadius: 999,
        border: `1px solid ${applied ? "var(--stroke-accent)" : "var(--stroke-secondary)"}`,
        background: applied ? "var(--wms-color-primary-50)" : "var(--surface-card)",
        font: "var(--type-body2)",
        fontWeight: "var(--weight-medium)",
        color: "var(--text-secondary)",
      }}
    >
      {icon && <span style={{ display: "inline-flex", color: "var(--icon-tertiary)" }}>{icon}</span>}
      <span>{label}</span>
      {applied && (
        <span style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-accent)" }}>{value}</span>
      )}
      {applied && clearHref && (
        <Link
          href={clearHref}
          scroll={false}
          aria-label={`Clear ${label} filter`}
          style={{ display: "inline-flex", color: "var(--icon-tertiary)", lineHeight: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </Link>
      )}
    </span>
  );
}

/**
 * A filter chip you can pick from, in the same pill the applied chips use.
 *
 * <p>The design draws filters as pills that open a list, not as boxed selects.
 * This is a real `<select>` sitting invisibly over the pill rather than a
 * hand-rolled popover: it keeps keyboard support, the native list on a phone,
 * and the screen-reader behaviour, none of which a div dressed as a menu gets
 * for free.
 *
 * <p>The pill shows the chosen option's name once something is picked, so the
 * value on screen is always the user's own word for it rather than a label we
 * hardcoded.
 */
export function FilterSelectChip({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  /** The selected option id, or "" for none. */
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const applied = value !== "";
  const selected = options.find((o) => o.id === value);

  return (
    <span
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
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span>{label}</span>
      {applied && (
        // Site and shift names are free text the customer can make as long as
        // they like, so the value truncates rather than stretching the pill
        // until the row wraps.
        <span
          className="truncate"
          style={{
            minWidth: 0,
            maxWidth: 160,
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-accent)",
          }}
        >
          {selected?.name ?? value}
        </span>
      )}
      <span style={{ display: "inline-flex", color: "var(--icon-tertiary)", lineHeight: 0 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <option value="">All {label.toLowerCase()}s</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * The bar that appears when rows are selected, carrying the actions that apply
 * to all of them.
 *
 * <p>Separate from the toolbar above it because it must not push the table
 * down on every render — it only exists while a selection does.
 */
export function SelectionBar({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg px-3.5 py-2.5"
      style={{ background: "var(--surface-info)", border: "1px solid var(--wms-color-primary-200)" }}
    >
      <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
        {label}
      </span>
      <div className="flex-1" />
      {children}
    </div>
  );
}
