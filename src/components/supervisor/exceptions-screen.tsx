"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Inbox } from "lucide-react";
import { ExceptionCard } from "@/components/supervisor/exception-card";
import {
  Button,
  EmptyState,
  FilterSelectChip,
  SearchInput,
  Toast,
  ToolsBar,
  ToolsCount,
  useToast,
} from "@/components/ui";

/**
 * The Exceptions screen, as the Claude Design handoff lays it out: one pinned
 * bar carrying the title, the search and every filter, a rail of who has
 * something open, and the exceptions themselves as cards.
 *
 * <p>The page used to be a fixed-height split pane whose two halves scrolled
 * independently inside `100vh - 6rem`. That arithmetic is gone. The page
 * scrolls as one, the bar pins to the top and the rail pins underneath it,
 * which is what the handoff does and which stops the pane running off a short
 * window.
 */

export type ExceptionRow = {
  id: string;
  exceptionType: string;
  description: string;
  occurredAt: Date;
  timesheetId: string;
  employeeId: string;
  employeeName: string;
  siteName: string | null;
  departmentName: string | null;
  /** "Sep 1 to Sep 14, 2026", the period's real last day. */
  payPeriod: { id: string; label: string };
  hasPunches: boolean;
  scheduled: { start: string | null; end: string | null };
  recorded: { in: string | null; out: string | null };
};

export type Option = { id: string; name: string };

/**
 * Three severities, which is the page's entire colour vocabulary.
 *
 * <p>Nothing in the schema ranks exception types, so the ranking lives here
 * with the screen that draws it. It answers one question, in the handoff's
 * words: does this hold up the pay period, does somebody have to confirm it,
 * or is it only on the record.
 */
const SEVERITY: Record<string, number> = {
  MISSING_PUNCH: 0,
  ABSENT: 0,
  SCAN_DISCREPANCY: 0,
  MISSED_MEAL: 1,
  SHORT_BREAK: 1,
  LONG_SHIFT: 1,
  UNSCHEDULED_OT: 1,
  LATE_IN: 2,
  EARLY_OUT: 2,
  CONSECUTIVE_DAYS: 2,
};

/** Anything unranked sorts with the lowest group rather than jumping the queue. */
function severityRank(exceptionType: string): number {
  return SEVERITY[exceptionType] ?? 2;
}

/** The left rule on a card and on a person in the rail. */
const SEVERITY_RULE = [
  "var(--fill-error)",
  "var(--fill-warning)",
  "var(--stroke-secondary)",
];

/** The rail's count pill, per severity: soft fill, strong text, a hairline. */
const COUNT_PILL = [
  { bg: "var(--surface-error)", fg: "var(--text-error)", line: "var(--stroke-error)" },
  { bg: "var(--surface-warning)", fg: "var(--text-warning)", line: "var(--stroke-warning)" },
  { bg: "var(--ta-track)", fg: "var(--text-secondary)", line: "transparent" },
];

/**
 * The heading above each block.
 *
 * <p>The handoff called these "Needs a fix", "To check" and "To review". The
 * three standard severity names say the same thing in the words every other
 * business tool uses, and they are what a supervisor already knows from the
 * rest of their software. The quiet line beside each one carries the meaning.
 */
/**
 * How many cards are drawn before the list asks.
 *
 * <p>A site mid-period can hold a few thousand open exceptions, and each card
 * here is a form. Rendering all of them costs seconds of layout for a screen
 * nobody reads past the first block of.
 */
const PAGE_SIZE = 25;

const SEVERITY_GROUP = [
  { label: "Critical", hint: "Hours stay wrong until these are corrected" },
  { label: "Warning", hint: "A rule was broken. Confirm or correct it." },
  { label: "Informational", hint: "Logged for the record" },
];

type Props = {
  rows: ExceptionRow[];
  /** Open counts per type, taken before the type filter ran. */
  typeCounts: Record<string, number>;
  typeLabels: Record<string, string>;
  sites: Option[];
  departments: Option[];
  shifts: Option[];
  payPeriods: Option[];
  reasonCodes: { id: string; code: string; label: string }[];
  selected: {
    siteId?: string;
    departmentId?: string;
    shiftId?: string;
    exceptionType?: string;
    payPeriodStart?: string;
    employeeId?: string;
  };
};

export function ExceptionsScreen({
  rows,
  typeCounts,
  typeLabels,
  sites,
  departments,
  shifts,
  payPeriods,
  reasonCodes,
  selected,
}: Props) {
  const router = useRouter();
  const { message: toast, flash } = useToast();
  const [query, setQueryState] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);

  /**
   * Who is open in the rail.
   *
   * <p>Component state rather than a query parameter, unlike every other
   * filter here. The server has already sent this person's rows, so a round
   * trip to hide the others would be a page load to filter in place. An
   * employeeId in the address bar is still honoured on the way in, so a link
   * to one person's exceptions lands where it always did.
   */
  const [openEmployeeId, setOpenEmployeeIdState] = useState<string | null>(
    selected.employeeId ?? null,
  );

  // Narrowing the list always starts it again from the top, so "show more"
  // never carries a page count over from a list that is no longer on screen.
  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setShown(PAGE_SIZE);
  }, []);

  const setOpenEmployeeId = useCallback((id: string | null) => {
    setOpenEmployeeIdState(id);
    setShown(PAGE_SIZE);
  }, []);

  /**
   * The bar pins, so the rail has to pin below it rather than at a guessed
   * offset. Its height is not a constant: the chips wrap onto a second line on
   * a narrow window and "Clear all" comes and goes. The handoff measures it
   * too, for the same reason.
   */
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(110);

  /**
   * The rail reaches the bottom of the window wherever the page is scrolled.
   *
   * <p>Measured rather than computed from constants, because the space left
   * under a pinned rail depends on the top bar, the pinned toolbar (which wraps
   * on a narrow window) and how far the page has scrolled before the rail
   * sticks. Only while the rail is actually pinned: on a narrow window it sits
   * in the flow above the cards, and a list as tall as the screen there would
   * push every exception off it.
   */
  const railRef = useRef<HTMLDivElement | null>(null);
  const [railHeight, setRailHeight] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const el = railRef.current;
      if (!el) return;
      if (getComputedStyle(el).position !== "sticky") {
        setRailHeight(null);
        return;
      }
      const h = Math.max(240, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 16));
      setRailHeight((prev) => (prev === h ? prev : h));
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    // Captured on the document, because scroll events do not bubble: this
    // catches the portal's inner scroller, the window, and anything else,
    // without having to work out which one it is.
    read();
    document.addEventListener("scroll", onChange, { capture: true, passive: true });
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      document.removeEventListener("scroll", onChange, { capture: true });
      window.removeEventListener("resize", onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const measureToolbar = useCallback(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const h = Math.round(el.getBoundingClientRect().height);
    if (h) setToolbarHeight((prev) => (prev === h ? prev : h));
  }, []);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measureToolbar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureToolbar]);

  /**
   * One filter changed, everything else kept.
   *
   * <p>These stay in the address bar rather than becoming component state, so
   * "the missing punches at 5903" is a link somebody can send. Changing any of
   * them drops the selected person, who may have nothing left in the new
   * scope, and landing on "nothing open for this person" reads as though their
   * exceptions had been resolved.
   */
  const navigate = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = { ...selected, employeeId: undefined, ...patch };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
      }
      const qs = params.toString();
      setOpenEmployeeId(null);
      router.push(`/supervisor/exceptions${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, selected, setOpenEmployeeId],
  );

  /**
   * Every type, always, with the count the census returned.
   *
   * <p>Built from the census rather than from the rows on screen. A list built
   * from what is left after filtering collapses to the one type you already
   * picked, and then the only way to look at another is to go back to "all"
   * first.
   */
  const typeOptions = useMemo(
    () =>
      Object.entries(typeLabels)
        .map(([value, label]) => ({
          id: value,
          name: `${label} (${typeCounts[value] ?? 0})`,
          count: typeCounts[value] ?? 0,
        }))
        // A type nobody has open is not worth a line in the list, but the one
        // that is selected stays even at zero, so it can be taken off again.
        .filter((o) => o.count > 0 || o.id === selected.exceptionType)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [typeLabels, typeCounts, selected.exceptionType],
  );

  const total = useMemo(
    () => Object.values(typeCounts).reduce((sum, n) => sum + n, 0),
    [typeCounts],
  );

  /**
   * Who has something open, counted on the way past the rows rather than by
   * filtering the whole list again per person. That was 2,619 exceptions
   * scanned once for each of 865 people, every time the page opened.
   */
  const people = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; count: number; kinds: string[]; worst: number }
    >();
    for (const row of rows) {
      let entry = byId.get(row.employeeId);
      if (!entry) {
        entry = { id: row.employeeId, name: row.employeeName, count: 0, kinds: [], worst: 2 };
        byId.set(row.employeeId, entry);
      }
      entry.count += 1;
      const label = typeLabels[row.exceptionType] ?? row.exceptionType;
      if (!entry.kinds.includes(label)) entry.kinds.push(label);
      entry.worst = Math.min(entry.worst, severityRank(row.exceptionType));
    }
    // Worst first, so the people holding up the close are at the top.
    return Array.from(byId.values()).sort(
      (a, b) => a.worst - b.worst || a.name.localeCompare(b.name),
    );
  }, [rows, typeLabels]);

  const matchesQuery = useCallback(
    (name: string) => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()),
    [query],
  );

  const visible = useMemo(
    () =>
      rows
        .filter((r) => (openEmployeeId ? r.employeeId === openEmployeeId : true))
        .filter((r) => matchesQuery(r.employeeName))
        .sort(
          (a, b) =>
            severityRank(a.exceptionType) - severityRank(b.exceptionType) ||
            a.occurredAt.getTime() - b.occurredAt.getTime(),
        ),
    [rows, openEmployeeId, matchesQuery],
  );

  const page = useMemo(() => visible.slice(0, shown), [visible, shown]);

  const dirty = Boolean(
    query ||
      openEmployeeId ||
      selected.siteId ||
      selected.departmentId ||
      selected.shiftId ||
      selected.exceptionType ||
      selected.payPeriodStart,
  );

  const matching = visible.length;
  const countLabel = matching === total ? `${total} open` : `${matching} of ${total}`;

  function exportUrl(): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(selected)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return `/api/reports/team-exceptions${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="relative flex flex-col gap-4">
      {/* The whole top of the page pins, not just the filters. Scrolling a
          queue of several hundred used to take the title and the export away
          with it. The title keeps its size while it is pinned: on a queue
          people work down for an hour, a heading that changes size as they
          scroll is movement with nothing to say. */}
      <div
        ref={toolbarRef}
        // Pulled up into the page's top padding so it already sits where it
        // pins: a bar that does not shrink has no business sliding either.
        className="ta-pin ta-canvas sticky top-0 z-20 flex flex-col"
      >
        <div
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
          style={{ paddingBottom: 12 }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              lineHeight: "36px",
              fontWeight: "var(--weight-bold)",
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Exceptions
          </h1>
          {/* On the title's own baseline, as the handoff has it. */}
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            Missing punches and rule breaks to resolve before close
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              hierarchy="secondary"
              size="sm"
              onClick={() => {
                // A normal navigation: the route answers with an attachment,
                // so the browser downloads it and the page stays put.
                window.location.assign(exportUrl());
                flash("Preparing your download");
              }}
            >
              Export
            </Button>
          </div>
        </div>

        {/* One bar for everything, the shared tools bar Live Attendance uses,
            so the pinned bar costs as little height as possible. It wraps on a
            narrow window rather than overflowing. */}
        <div className="pb-3.5">
          <ToolsBar
            search={
              <SearchInput
                aria-label="Search employees"
                placeholder="Search employees"
                value={query}
                onValueChange={setQuery}
              />
            }
            end={
              <>
                {dirty && (
                  <Button
                    hierarchy="link"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setOpenEmployeeId(null);
                      router.push("/supervisor/exceptions", { scroll: false });
                    }}
                  >
                    Clear all
                  </Button>
                )}
                <ToolsCount>{countLabel}</ToolsCount>
              </>
            }
          >

            <FilterSelectChip
              label="Type"
              value={selected.exceptionType ?? ""}
              options={typeOptions}
              onChange={(id) => navigate({ exceptionType: id || undefined })}
            />
            <FilterSelectChip
              label="Department"
              value={selected.departmentId ?? ""}
              options={departments}
              onChange={(id) => navigate({ departmentId: id || undefined })}
            />
            <FilterSelectChip
              label="Shift"
              value={selected.shiftId ?? ""}
              options={shifts}
              onChange={(id) => navigate({ shiftId: id || undefined })}
            />
            <FilterSelectChip
              label="Site"
              value={selected.siteId ?? ""}
              options={sites}
              // Departments are listed per site, so the department picked under
              // the old one goes too. Otherwise the list stays narrowed by a
              // department the new site may not even have, and reads as clean.
              onChange={(id) => navigate({ siteId: id || undefined, departmentId: undefined })}
            />
            {/* Not in the handoff, and kept: closing a period is the whole
                reason this screen gets worked through, so the period has to be
                selectable. Rendered as a pill like the others rather than as
                the select it used to be. */}
            <FilterSelectChip
              label="Pay period"
              value={selected.payPeriodStart ?? ""}
              options={payPeriods}
              disabled={payPeriods.length === 0}
              onChange={(id) => navigate({ payPeriodStart: id || undefined })}
            />
          </ToolsBar>
        </div>
      </div>

      <div className="ta-split flex flex-wrap items-start gap-4">
        {/* Who has something open. Pinned under the bar rather than scrolling
            with the cards, so moving from one person to the next never means
            scrolling back up for the list. */}
        <div
          ref={railRef}
          className="ta-rail min-w-0 flex-[1_1_216px]"
          style={{ maxWidth: 256, "--ta-rail-top": `${toolbarHeight + 14}px` } as React.CSSProperties}
        >
          <div
            className="flex flex-col overflow-hidden"
            style={{
              height: railHeight ?? undefined,
              background: "var(--surface-card)",
              border: "1px solid var(--stroke-secondary)",
              borderRadius: "var(--radius-m)",
            }}
          >
            <div
              className="wms-overline shrink-0 px-3.5 py-2.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              Employees ({people.length})
            </div>
            <div
              className={`ta-scroll flex min-h-0 flex-1 flex-col overflow-y-auto ${railHeight === null ? "max-h-[460px]" : ""}`}
            >
              <RailRow
                name="All employees"
                summary="Everyone with an open exception"
                count={rows.filter((r) => matchesQuery(r.employeeName)).length}
                selected={!openEmployeeId}
                severity={null}
                onClick={() => setOpenEmployeeId(null)}
              />
              {people.length > 0 && people.filter((p) => matchesQuery(p.name)).length === 0 && (
                <p
                  className="px-3.5 py-4 text-center"
                  style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                >
                  No match
                </p>
              )}
              {people
                .filter((p) => matchesQuery(p.name))
                .map((p) => (
                  <RailRow
                    key={p.id}
                    name={p.name}
                    summary={p.kinds.join(", ")}
                    count={p.count}
                    selected={openEmployeeId === p.id}
                    severity={p.worst}
                    // Clicking the person you already have open takes you back
                    // to everyone, so the rail is never a place you get stuck.
                    onClick={() => setOpenEmployeeId(openEmployeeId === p.id ? null : p.id)}
                  />
                ))}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-[4_1_380px] flex-col gap-2.5">
          {visible.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-8 w-8" />}
              // "No open exceptions" is a claim somebody closes a pay period
              // on, so it is only made when nothing at all is narrowing the
              // list. With a filter set, the rest of the queue is off screen,
              // and saying the queue is empty is how a supervisor stops
              // looking.
              title={
                openEmployeeId
                  ? "Nothing open for this person"
                  : dirty
                    ? "Nothing matches these filters"
                    : "No open exceptions"
              }
              body={
                openEmployeeId
                  ? "Other people in the rail may still have exceptions open."
                  : dirty
                    ? "There may still be exceptions outside the search, type, department, shift, site or pay period you have set."
                    : "Every timecard in range is clean."
              }
            />
          ) : (
            page.map((ex, i) => {
              const severity = severityRank(ex.exceptionType);
              const group = SEVERITY_GROUP[severity];
              // A heading only where the severity changes, which is what the
              // sort above makes possible: one block per severity, in order.
              const opensGroup = i === 0 || severityRank(page[i - 1].exceptionType) !== severity;
              const groupCount = visible.filter(
                (r) => severityRank(r.exceptionType) === severity,
              ).length;

              return (
                <div key={ex.id} className="flex flex-col gap-2.5">
                  {opensGroup && (
                    <div
                      className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1"
                      style={{ paddingTop: i === 0 ? 0 : 10 }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          alignSelf: "center",
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: SEVERITY_RULE[severity],
                        }}
                      />
                      <span
                        style={{
                          font: "var(--type-body1)",
                          fontWeight: "var(--weight-semibold)",
                          color: "var(--text-primary)",
                        }}
                      >
                        {group.label}
                      </span>
                      <span
                        className="tabular"
                        style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                      >
                        {groupCount}
                      </span>
                      <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                        {group.hint}
                      </span>
                    </div>
                  )}
                  <ExceptionCard
                    row={ex}
                    typeLabel={typeLabels[ex.exceptionType] ?? ex.exceptionType}
                    severity={severity}
                    reasonCodes={reasonCodes}
                    onDone={flash}
                  />
                </div>
              );
            })
          )}

          {visible.length > page.length && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span
                className="tabular"
                style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
              >
                Showing {page.length} of {visible.length}
              </span>
              <Button
                hierarchy="secondary"
                size="sm"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, visible.length - page.length)} more
              </Button>
            </div>
          )}
        </div>
      </div>

      <Toast message={toast} />
    </div>
  );
}

/**
 * One person in the rail, or the way back out to everybody.
 *
 * <p>A button rather than a link, because the rows it filters are already in
 * the browser. The count sits in a pill tinted by the worst thing this person
 * has open, so the rail is scannable without reading any of the summaries. It
 * used to be a coloured rule down the left edge of every row, which on a list
 * where nearly everybody has something critical turned the rail into a red
 * stripe and said nothing.
 */
function RailRow({
  name,
  summary,
  count,
  selected,
  severity,
  onClick,
}: {
  name: string;
  summary: string;
  count: number;
  selected: boolean;
  /** 0 critical, 1 warning, 2 anything else; null for the All row. */
  severity: number | null;
  onClick: () => void;
}) {
  const pill = severity === null ? COUNT_PILL[2] : COUNT_PILL[severity] ?? COUNT_PILL[2];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className="ta-rail-row flex w-full items-center gap-2.5 px-3.5 py-2 text-left"
      style={{
        boxSizing: "border-box",
        border: 0,
        borderBottom: "1px solid var(--stroke-divider)",
        background: selected ? "var(--surface-info)" : "transparent",
        cursor: "pointer",
      }}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span
          className="truncate"
          style={{
            font: "var(--type-body1)",
            fontWeight: "var(--weight-medium)",
            color: selected ? "var(--text-accent)" : "var(--text-primary)",
          }}
        >
          {name}
        </span>
        <span
          className="truncate"
          style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}
        >
          {summary}
        </span>
      </span>
      <span
        className="tabular"
        aria-label={`${count} open${severity === 0 ? ", critical" : severity === 1 ? ", warning" : ""}`}
        style={{
          flex: "none",
          minWidth: 24,
          height: 20,
          padding: "0 7px",
          boxSizing: "border-box",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: pill.bg,
          color: pill.fg,
          boxShadow: `inset 0 0 0 1px ${pill.line}`,
          font: "var(--weight-semibold) 12px/16px var(--font-sans)",
          whiteSpace: "nowrap",
        }}
      >
        {count}
      </span>
    </button>
  );
}
