"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { Button, SegmentedControl } from "@/components/ui";
import { REPORT_GROUPS, dataSourceDescription, dataSourceLabel } from "./data-source-label";
import { ReportTypeIcon } from "./report-type-icon";
import { STANDARD_FOLDERS, type StandardReport } from "@/lib/reports/standard-reports";
import { describePrint } from "@/lib/reports/grouping";
import type { DataSourceId } from "@/lib/validators/report.schema";
import phone from "./reports-phone.module.css";

export interface ReportTypeOption {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string;
  columns?: { id: string; label: string; type?: string; defaultVisible?: boolean }[];
  filters?: { id: string; label: string }[];
  groupableFields?: string[];
}

/**
 * The window New report opens: which report to build, before any page.
 *
 * <p>A list of the report types on the left, all one height, and the one
 * highlighted described on the right: what it answers, the columns it starts
 * with, what it can be filtered and grouped by. All of that is read from the
 * report's own definition, so it says what the builder will actually offer.
 * One click highlights, Set up this report (or a double click, or Enter)
 * opens the builder on it.
 *
 * <p>A new report can also start from a standard report: NovaTime's
 * templates, in NovaTime's folders and under its names, each a report type
 * already set up. That list comes first, since it is how HR knows its
 * reports; Blank report is the types themselves.
 *
 * <p>The same window changes the type from inside the builder, where it says
 * that a different type starts the columns and filters over, since that is
 * the one thing switching throws away.
 */
export function ReportTypeDialog({
  sources,
  selected = null,
  changing = false,
  standards = [],
  onPick,
  onPickStandard,
  onClose,
}: {
  sources: ReportTypeOption[];
  selected?: DataSourceId | null;
  /** Opened from the builder, over a report already being set up. */
  changing?: boolean;
  /** The standard reports to offer, for a new report. */
  standards?: StandardReport[];
  onPick: (id: DataSourceId) => void;
  onPickStandard?: (id: string) => void;
  onClose: () => void;
}) {
  const byId = new Map(sources.map((s) => [s.id as string, s]));
  const grouped = new Set(REPORT_GROUPS.flatMap((g) => g.ids));
  const groups = [
    ...REPORT_GROUPS.map((g) => ({
      title: g.title,
      items: g.ids.map((id) => byId.get(id)).filter((s): s is ReportTypeOption => !!s),
    })),
    { title: "Other", items: sources.filter((s) => !grouped.has(s.id)) },
  ].filter((g) => g.items.length > 0);
  const order = groups.flatMap((g) => g.items);

  // Standard reports a new report can start from, in NovaTime's folders.
  const offerStandards = !changing && standards.length > 0 && !!onPickStandard;
  const folders = STANDARD_FOLDERS.map((f) => ({ title: f, items: standards.filter((r) => r.folder === f) })).filter(
    (f) => f.items.length > 0
  );
  const standardOrder = folders.flatMap((f) => f.items);
  const [mode, setMode] = useState<"standard" | "blank">(offerStandards ? "standard" : "blank");
  const [activeStandard, setActiveStandard] = useState<string | undefined>(() => standardOrder[0]?.id);
  const currentStandard = standards.find((r) => r.id === activeStandard);
  const showingStandards = offerStandards && mode === "standard";

  const [active, setActive] = useState<DataSourceId | undefined>(
    () => (selected && byId.has(selected) ? selected : order[0]?.id)
  );
  const current = active ? byId.get(active) : undefined;
  const unchanged = changing && active === selected;

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Focus comes in on the highlighted row and goes back to the opener.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[aria-selected=true]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  function confirm(id = active) {
    if (!id || (changing && id === selected)) return;
    onPick(id);
  }

  function confirmStandard(id = activeStandard) {
    if (id) onPickStandard?.(id);
  }

  // Up and down move through the list, the way a list box does.
  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const ids = showingStandards ? standardOrder.map((r) => r.id) : order.map((s) => s.id as string);
    const at = ids.indexOf((showingStandards ? activeStandard : active) ?? "");
    const next = ids[(at + (e.key === "ArrowDown" ? 1 : ids.length - 1)) % ids.length];
    if (!next) return;
    if (showingStandards) setActiveStandard(next);
    else setActive(next as DataSourceId);
    dialogRef.current?.querySelector<HTMLElement>(`[data-type="${next}"]`)?.focus();
  }

  return (
    <div
      className="ta-sheet-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-type-title"
        className={`${phone.typeSheet} ta-sheet ta-modal flex max-h-[calc(100dvh-2rem)] w-full max-w-[880px] flex-col overflow-hidden`}
        style={{ borderRadius: "var(--radius-l)", height: 600 }}
      >
        <header
          className="flex flex-none items-center gap-3 px-6 py-4"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id="report-type-title" style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
              {changing ? "Change report type" : "New report"}
            </h2>
            <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {changing ? "Pick the report to switch to." : "Pick the report to start from."}
            </span>
          </span>
          <Button hierarchy="tertiary" iconOnly onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className={`${phone.typeBody} grid min-h-0 flex-1 [grid-template-columns:272px_minmax(0,1fr)]`}>
          {/* ── The types ─────────────────────────────────────────── */}
          <div
            className={`${phone.typeRail} flex min-h-0 flex-col`}
            style={{ background: "var(--surface-secondary)", borderRight: "1px solid var(--stroke-divider)" }}
          >
            {offerStandards && (
              <div className="flex-none px-3 pt-3">
                <SegmentedControl
                  fullWidth
                  ariaLabel="Start from"
                  value={mode}
                  onChange={(v) => setMode(v as "standard" | "blank")}
                  items={[
                    { value: "standard", label: "Standard reports" },
                    { value: "blank", label: "Blank report" },
                  ]}
                />
              </div>
            )}
            <div
              role="listbox"
              aria-label={showingStandards ? "Standard reports" : "Report types"}
              onKeyDown={onListKey}
              className="ta-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3"
            >
              {showingStandards && folders.map((f) => (
                <div key={f.title} role="group" aria-label={f.title} className="flex flex-col gap-0.5">
                  <span className="px-2.5 pb-1.5 pt-1" style={GROUP_LABEL}>{f.title}</span>
                  {f.items.map((r) => (
                    <ListRow
                      key={r.id}
                      id={r.id}
                      icon={r.source}
                      label={r.name}
                      on={r.id === activeStandard}
                      onSelect={() => setActiveStandard(r.id)}
                      onConfirm={() => confirmStandard(r.id)}
                    />
                  ))}
                </div>
              ))}
              {!showingStandards && groups.map((g) => (
                <div key={g.title} role="group" aria-label={g.title} className="flex flex-col gap-0.5">
                  <span className="px-2.5 pb-1.5 pt-1" style={GROUP_LABEL}>{g.title}</span>
                  {g.items.map((ds) => (
                    <ListRow
                      key={ds.id}
                      id={ds.id}
                      icon={ds.id}
                      label={dataSourceLabel(ds.id)}
                      on={ds.id === active}
                      current={changing && ds.id === selected}
                      onSelect={() => setActive(ds.id)}
                      onConfirm={() => confirm(ds.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* ── The one highlighted ───────────────────────────────── */}
          {showingStandards
            ? currentStandard && <StandardDetail report={currentStandard} type={byId.get(currentStandard.source)} />
            : current && <TypeDetail type={current} />}
        </div>

        <footer
          className={`${phone.typeFoot} flex flex-none items-center gap-2 px-6 py-3.5`}
          style={{ borderTop: "1px solid var(--stroke-divider)" }}
        >
          <span className="min-w-0 flex-1" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
            {changing
              ? "Switching starts the columns and filters over. The dates stay."
              : showingStandards
                ? "It opens set up as shown. Run it as it is, or change anything first."
                : "Next you pick the dates, and can change any of this."}
          </span>
          <Button hierarchy="secondary" onClick={onClose}>
            Cancel
          </Button>
          {showingStandards ? (
            <Button
              hierarchy="primary"
              disabled={!currentStandard}
              onClick={() => confirmStandard()}
              trailingIcon={<ArrowRight className="h-4 w-4" />}
            >
              Open this report
            </Button>
          ) : (
            <Button
              hierarchy="primary"
              disabled={!current || unchanged}
              onClick={() => confirm()}
              trailingIcon={<ArrowRight className="h-4 w-4" />}
            >
              {changing ? "Switch to this report" : "Set up this report"}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** A folder's name over its reports: quiet and in sentence case, as in every window. */
const GROUP_LABEL = { font: "var(--type-caption1)", fontWeight: "var(--weight-medium)", color: "var(--text-tertiary)" } as const;

/** One row of the list: a report type or a standard report. */
function ListRow({
  id,
  icon,
  label,
  on,
  current = false,
  onSelect,
  onConfirm,
}: {
  id: string;
  icon: DataSourceId;
  label: string;
  on: boolean;
  /** The type the report being changed already has. */
  current?: boolean;
  onSelect: () => void;
  onConfirm: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      data-type={id}
      tabIndex={on ? 0 : -1}
      onClick={onSelect}
      onDoubleClick={onConfirm}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onConfirm())}
      className={`flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left ${on ? "" : "ta-hoverable"}`}
      style={{
        border: 0,
        cursor: "pointer",
        background: on ? "var(--surface-card)" : "transparent",
        boxShadow: on ? "var(--shadow-card)" : undefined,
      }}
    >
      <ReportTypeIcon id={icon} size={28} />
      <span
        className="min-w-0 flex-1 truncate"
        style={{
          font: `${on ? "var(--weight-semibold)" : "var(--weight-medium)"} 14px/20px var(--font-sans)`,
          color: on ? "var(--text-primary)" : "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      {current && (
        <span className="whitespace-nowrap" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
          Current
        </span>
      )}
    </button>
  );
}

const STANDARD_DATES: Record<StandardReport["dates"], string> = {
  currentPayPeriod: "Current pay period, moving on by itself",
  previousPayPeriod: "Previous pay period, moving on by itself",
  currentWeek: "This week, moving on by itself",
  currentMonth: "This month, moving on by itself",
  previousMonth: "Last month, moving on by itself",
  currentYear: "This year, moving on by itself",
  last7Days: "The last 7 days, moving on by itself",
  yesterday: "Yesterday, moving on by itself",
};

const FILTER_WORDS: Record<string, string> = {
  eq: "is",
  gte: "is at least",
  lte: "is at most",
  inRange: "is in the report dates",
};

/** A standard report: what it answers, and exactly how it opens. */
function StandardDetail({ report, type }: { report: StandardReport; type?: ReportTypeOption }) {
  const labelOf = new Map((type?.columns ?? []).map((c) => [c.id, c.label]));
  const kindOf = new Map((type?.columns ?? []).map((c) => [c.id, c.type]));
  const filterLabel = new Map((type?.filters ?? []).map((f) => [f.id, f.label]));
  const columns = report.columns.map((id) => labelOf.get(id) ?? id);
  const groups = (report.groupBy ?? []).map((id) => labelOf.get(id) ?? id);
  const sorts = (report.sortBy ?? []).map((s) => {
    const label = labelOf.get(s.field) ?? s.field;
    if (s.direction === "asc") return label;
    return `${label}, ${kindOf.get(s.field) === "date" ? "newest" : "highest"} first`;
  });
  const filters = (report.filters ?? []).map((f) =>
    [filterLabel.get(f.field) ?? f.field, FILTER_WORDS[f.operator] ?? f.operator, f.operator === "inRange" ? "" : String(f.value)]
      .filter(Boolean)
      .join(" ")
  );

  return (
    <div className="ta-scroll flex min-h-0 flex-col overflow-y-auto px-8 py-7">
      <div className="flex items-start gap-4">
        <ReportTypeIcon id={report.source} size={48} />
        <span className="flex min-w-0 flex-col gap-1 pt-0.5">
          <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{report.name}</h3>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            {report.description}
          </p>
        </span>
      </div>

      <div className="mt-7 flex flex-col" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        <DetailRow title="Dates">{STANDARD_DATES[report.dates]}</DetailRow>
        {report.across && (
          <DetailRow title="Across">
            A column for each {(labelOf.get(report.across.field) ?? report.across.field).toLowerCase()}, showing{" "}
            {(labelOf.get(report.across.value) ?? report.across.value).toLowerCase()}, with a total
          </DetailRow>
        )}
        <DetailRow title="Columns">
          <span className="flex flex-wrap gap-1.5">
            {columns.map((label) => (
              <Chip key={label}>{label}</Chip>
            ))}
          </span>
        </DetailRow>
        {groups.length > 0 && <DetailRow title="Grouped by">{groups.join(", then ")}, with totals</DetailRow>}
        {sorts.length > 0 && <DetailRow title="Sorted by">{sorts.join(", then ")}</DetailRow>}
        {filters.length > 0 && <DetailRow title="Filter">{filters.join(". ")}</DetailRow>}
        {report.layout && <DetailRow title="Printed">{describePrint(report.layout, (id) => labelOf.get(id) ?? id)}</DetailRow>}
        <DetailRow title="Built on">{dataSourceLabel(report.source)}</DetailRow>
        <DetailRow title="In NovaTime">{report.novaTimeName}</DetailRow>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md pl-1.5 pr-2"
      style={{
        background: "var(--surface-secondary)",
        border: "1px solid var(--stroke-secondary)",
        font: "var(--type-caption1)",
        fontWeight: "var(--weight-medium)",
        color: "var(--text-primary)",
      }}
    >
      <Check className="h-3 w-3" style={{ color: "var(--icon-accent)" }} aria-hidden="true" />
      {children}
    </span>
  );
}

/** What the highlighted report answers, and what the builder will offer for it. */
function TypeDetail({ type }: { type: ReportTypeOption }) {
  const columns = type.columns ?? [];
  const starts = columns.filter((c) => c.defaultVisible);
  const more = columns.filter((c) => !c.defaultVisible);
  const labelOf = new Map(columns.map((c) => [c.id, c.label]));
  const groupBy = (type.groupableFields ?? []).map((f) => labelOf.get(f)).filter((l): l is string => !!l);
  const filters = (type.filters ?? []).map((f) => f.label);

  return (
    <div className="ta-scroll flex min-h-0 flex-col overflow-y-auto px-8 py-7">
      <div className="flex items-start gap-4">
        <ReportTypeIcon id={type.id} size={48} />
        <span className="flex min-w-0 flex-col gap-1 pt-0.5">
          <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{dataSourceLabel(type.id)}</h3>
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            {dataSourceDescription(type.id) || type.description}
          </p>
        </span>
      </div>

      <div className="mt-7 flex flex-col" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
        {starts.length > 0 && (
          <DetailRow title="Columns">
            <span className="flex flex-wrap gap-1.5">
              {starts.map((c) => (
                <Chip key={c.id}>{c.label}</Chip>
              ))}
            </span>
            {more.length > 0 && (
              <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                Can also add {joinWords(more.map((c) => c.label))}
              </span>
            )}
          </DetailRow>
        )}
        {filters.length > 0 && <DetailRow title="Filter by">{joinWords(filters)}</DetailRow>}
        {groupBy.length > 0 && <DetailRow title="Group by">{joinWords(groupBy)}</DetailRow>}
      </div>
    </div>
  );
}

function DetailRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="grid gap-4 py-3.5 [grid-template-columns:88px_minmax(0,1fr)]"
      style={{ borderBottom: "1px solid var(--stroke-divider)" }}
    >
      <span className="pt-0.5" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
        {title}
      </span>
      <span className="flex min-w-0 flex-col gap-2" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
        {children}
      </span>
    </div>
  );
}

/** "Site, Department and Status". */
function joinWords(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
