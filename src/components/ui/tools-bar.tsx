"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { usePhoneLayout } from "@/lib/phone";
import { Button } from "./button";
import { Overlay } from "./overlay";

/**
 * The white tools bar from the Live Attendance handoff, for every list screen
 * that searches and filters: anything that leads (a date range), the search,
 * the filters, then whatever sits at the end (Clear all, the count, a sort)
 * pushed right.
 *
 * <p>It has exactly two shapes, never an accidental third. When everything
 * fits, one line. When it does not, two planned lines: the search and the end
 * on top, every filter on the line under it. Letting the row wrap on its own
 * left the count stranded on a second line with nothing beside it, which is
 * the first thing anyone notices. Whether it fits is measured, not guessed
 * from the window width, because it depends on how many filters a screen has
 * and how long the chosen values are.
 *
 * <p>View tabs never sit beside it. As on Live Attendance they go in the title
 * row with the page's actions, and the bar has a line of its own: next to a
 * white bar a grey tab control read as a second, unrelated box.
 */

/** The width the search gives way to before anything moves to a second line. */
const SEARCH_MIN = 170;

/** Whether anything would draw, looking inside fragments. */
function hasContent(node: ReactNode): boolean {
  return Children.toArray(node).some((c) =>
    isValidElement(c) && (c as ReactElement).type === Fragment
      ? hasContent((c as ReactElement<{ children?: ReactNode }>).props.children)
      : true,
  );
}

function outerWidth(el: Element) {
  const cs = getComputedStyle(el);
  return el.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
}

type ToolsBarProps = {
  /** Drawn before the search, on the top line (a date range and Today). */
  lead?: ReactNode;
  search?: ReactNode;
  /** The filters. They move to their own line when the bar cannot hold one. */
  children?: ReactNode;
  end?: ReactNode;
  /** Extra classes, for a screen that styles its own controls inside the bar. */
  className?: string;
};

export function ToolsBar(props: ToolsBarProps) {
  return usePhoneLayout() ? <PhoneToolsBar {...props} /> : <WideToolsBar {...props} />;
}

/**
 * The bar on a phone: the search and a Filters button on one line, so the
 * list starts near the top of the screen. The filters, the sort and the
 * view choices open in a sheet. A filter that is on stays in sight under
 * the search with its own ✕, because a filter you cannot see is one nobody
 * takes off. The count sits under the bar.
 */
function PhoneToolsBar({ lead, search, children, end, className }: ToolsBarProps) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(0);
  const appliedRef = useRef<HTMLSpanElement | null>(null);
  const hasFilters = hasContent(children);
  const hasEnd = hasContent(end);
  // A bar whose end is only the count has nothing for a Filters sheet.
  const sheetEnd = hasEnd && !(isValidElement(end) && (end as ReactElement).type === ToolsCount);

  // How many filters are on, read from the pills themselves, since each
  // screen marks its own.
  useEffect(() => {
    const row = appliedRef.current;
    if (!row) return;
    const count = () => setApplied(row.querySelectorAll('[data-applied="true"]').length);
    count();
    const mo = new MutationObserver(count);
    mo.observe(row, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-applied"] });
    return () => mo.disconnect();
  }, [hasFilters]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className={`ta-tools ta-tools-phone${className ? ` ${className}` : ""}`}>
        {hasContent(lead) && (
          <span data-part="lead" className="ta-tools-group">
            {lead}
          </span>
        )}
        <span className="ta-tools-line">
          {hasContent(search) && (
            <span data-part="search" className="ta-tools-search">
              {search}
            </span>
          )}
          {(hasFilters || sheetEnd) && (
            <button
              type="button"
              className="ta-tools-filter-btn"
              data-applied={applied > 0 ? "true" : undefined}
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
              <span>Filters</span>
              {applied > 0 && <span className="ta-tools-filter-count tabular">{applied}</span>}
            </button>
          )}
        </span>
        {hasFilters && (
          <span ref={appliedRef} data-part="filters" className="ta-tools-filters" data-any={applied > 0 ? "true" : undefined}>
            {children}
          </span>
        )}
      </div>
      {hasEnd && <span className="ta-tools-under">{end}</span>}
      {open &&
        <Overlay
            className="ta-sheet-scrim z-[60] flex"
            style={{ background: "var(--wms-overlay-modal)" }}
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div className="ta-sheet ta-filter-sheet" role="dialog" aria-modal="true" aria-label="Filters">
              <div className="ta-filter-sheet-head">
                <h2>Filters</h2>
                <button type="button" className="ta-filter-sheet-close" aria-label="Close" onClick={() => setOpen(false)}>
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              {hasFilters && <div className="ta-filter-sheet-group">{children}</div>}
              {sheetEnd && <div className="ta-filter-sheet-group ta-filter-sheet-end">{end}</div>}
              <div className="ta-sheet-actions ta-filter-sheet-foot">
                <Button hierarchy="primary" onClick={() => setOpen(false)}>
                  Show results
                </Button>
              </div>
            </div>
          </Overlay>}
    </>
  );
}

function WideToolsBar({ lead, search, children, end, className }: ToolsBarProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  // Filters are usually conditional ({sites.length > 1 && ...}), so a list of
  // falses must not draw an empty group and a divider in front of it.
  const hasFilters = hasContent(children);
  const [stacked, setStacked] = useState(false);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver !== "function") return;

    const measure = () => {
      const cs = getComputedStyle(bar);
      const gap = parseFloat(cs.columnGap) || 0;
      const parts = Array.from(bar.children).filter((el) => (el as HTMLElement).dataset.part);
      let need = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + gap * Math.max(0, parts.length - 1);
      for (const el of parts) {
        const part = (el as HTMLElement).dataset.part;
        if (part === "search") {
          const inner = el.firstElementChild;
          need += Math.max(SEARCH_MIN, inner ? parseFloat(getComputedStyle(inner).minWidth) || 0 : 0);
        }
        else if (part === "end") need += el.getBoundingClientRect().width;
        else if (part === "filters") {
          // Its one-line width, whichever shape the bar is in right now.
          const kids = Array.from(el.children);
          const kidGap = parseFloat(getComputedStyle(el).columnGap) || 0;
          need += kids.reduce((sum, k) => sum + outerWidth(k), 0) + kidGap * Math.max(0, kids.length - 1);
        } else need += outerWidth(el);
      }
      setStacked(bar.clientWidth + 0.5 < need);
    };

    const ro = new ResizeObserver(measure);
    const watch = () => {
      ro.disconnect();
      ro.observe(bar);
      for (const el of Array.from(bar.children)) {
        ro.observe(el);
        if ((el as HTMLElement).dataset.part === "filters") for (const k of Array.from(el.children)) ro.observe(k);
      }
    };
    // Filters come and go (a Site pill only when there is more than one
    // site), and a chosen value makes its pill wider.
    const mo = new MutationObserver(() => {
      watch();
      measure();
    });
    mo.observe(bar, { childList: true, subtree: true, characterData: true });
    watch();
    measure();
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div
      ref={barRef}
      className={`ta-tools${className ? ` ${className}` : ""}`}
      data-stacked={stacked ? "true" : undefined}
    >
      {hasContent(lead) && (
        <span data-part="lead" className="ta-tools-group">
          {lead}
        </span>
      )}
      {hasContent(lead) && hasContent(search) && <span data-part="divider" aria-hidden className="ta-tools-divider" />}
      {hasContent(search) && (
        <span data-part="search" className="ta-tools-search">
          {search}
        </span>
      )}
      {(hasContent(lead) || hasContent(search)) && hasFilters && (
        <span data-part="divider" aria-hidden className="ta-tools-divider ta-tools-divider-filters" />
      )}
      {hasFilters && (
        <span data-part="filters" className="ta-tools-filters">
          {children}
        </span>
      )}
      {hasContent(end) && (
        <span data-part="end" className="ta-tools-end">
          {end}
        </span>
      )}
    </div>
  );
}

/** The count at the end of a tools bar: "12 of 40 reports", or "40 reports". */
export function ToolsCount({ children }: { children: ReactNode }) {
  return <span className="ta-tools-count tabular">{children}</span>;
}
