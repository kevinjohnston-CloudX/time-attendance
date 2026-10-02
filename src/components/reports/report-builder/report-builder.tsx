"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { ArrowLeft, ChevronDown, Play, RefreshCw, Save, Table2, X } from "lucide-react";
import { Banner, Button, EmptyState, Input, LinkButton, PageHeader, Textarea } from "@/components/ui";
import { ReportTypeIcon } from "../report-type-icon";
import { ReportTypeDialog } from "../report-type-dialog";
import { ColumnPicker } from "./column-picker";
import { FilterBuilder } from "./filter-builder";
import { DateRangePicker, defaultPayPeriodRange, describeRange } from "./date-range-picker";
import { GroupSortConfig } from "./group-sort-config";
import { ResultsTable } from "../report-results/results-table";
import { dataSourceDescription, dataSourceLabel, isScanReport } from "../data-source-label";
import { runReport, createReport } from "@/actions/report.actions";
import type { DataSourceId, FilterDef, SortDef, DateRange } from "@/lib/validators/report.schema";
import type { ReportResult } from "@/lib/reports/data-sources";

/**
 * The report builder: the settings down a rail on the left, the rows they
 * produce filling the rest of the window, both reaching its bottom edge.
 *
 * <p>The type is picked in the New report window before this page opens, so
 * the page always has a report to show. It runs a preview straight away and
 * again whenever the type changes; any other change marks the preview out of
 * date rather than running it on every tick of a checkbox, since each run is
 * a query over everyone in the dates.
 *
 * <p>Save asks for a name in a small window, filled in from the type, and
 * opens the saved report. Group and sort are folded away, since most reports
 * never need them.
 */

interface DataSourceMeta {
  id: DataSourceId;
  label: string;
  description: string;
  icon: string;
  columns: { id: string; label: string; type: string; defaultVisible?: boolean }[];
  filters: { id: string; label: string; type: string; operators: string[]; options?: { value: string; label: string }[] }[];
  groupableFields: string[];
}

interface FilterOptions {
  sites: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  payPeriods: { id: string; startDate: string | Date; endDate: string | Date; status: string }[];
  leaveTypes: { id: string; name: string }[];
  payCodes: { code: number; label: string }[];
}

/** A preview stops here; the report only counts the rows it returned, so a
 *  full preview cannot say how many more there are. */
const PREVIEW_ROWS = 100;

/**
 * How many rows a saved report returns. The scan reports hold a row per person
 * per day, so a month of two buildings is several thousand and a year is far
 * more; the usual 5,000 would quietly cut a monthly email short.
 */
const savedLimit = (id: string) => (isScanReport(id) ? 50000 : 5000);

/** Where the rail and the preview sit side by side, the same test the pinned bar uses. */
const SIDE_BY_SIDE = "(min-width: 1024px) and (min-height: 600px)";

export function ReportBuilder({
  dataSources,
  filterOptions,
  initialSource,
}: {
  dataSources: DataSourceMeta[];
  filterOptions: FilterOptions;
  /** The type picked in the New report window. */
  initialSource: DataSourceId;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const previewRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const defaultsFor = (id: DataSourceId) =>
    dataSources.find((ds) => ds.id === id)?.columns.filter((c) => c.defaultVisible).map((c) => c.id) ?? [];

  const [dataSource, setDataSource] = useState<DataSourceId>(initialSource);
  const [changingSource, setChangingSource] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => defaultsFor(initialSource));
  const [filters, setFilters] = useState<FilterDef[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultRangeFor(initialSource));
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortDef[]>([]);
  const [showMore, setShowMore] = useState(false);

  const [previewResult, setPreviewResult] = useState<ReportResult | null>(null);
  const [previewedWith, setPreviewedWith] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // A name is filled in from the report picked, and follows it when the
  // report changes, until somebody types their own.
  const [saving, setSaving] = useState(false);
  const [reportName, setReportName] = useState(() => dataSourceLabel(initialSource));
  const [nameTouched, setNameTouched] = useState(false);
  const [reportDesc, setReportDesc] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentSource = dataSources.find((ds) => ds.id === dataSource);

  /**
   * Where a report opens its dates. The scan reports are daily files, so they
   * open on yesterday; the rest on the current pay period.
   */
  function defaultRangeFor(id: DataSourceId): DateRange {
    if (isScanReport(id)) return { type: "yesterday" };
    return defaultPayPeriodRange(filterOptions.payPeriods) ?? { type: "relative", relativeDays: 14 };
  }

  function handleDataSourceChange(id: DataSourceId) {
    setChangingSource(false);
    if (id === dataSource) return;
    setDataSource(id);
    // The link follows, so a reload opens on the type now showing. Without a
    // navigation: nothing on the server needs to answer for it.
    window.history.replaceState(window.history.state, "", `/reports/new?source=${id}`);
    setSelectedColumns(defaultsFor(id));
    setFilters([]);
    setGroupBy([]);
    setSortBy([]);
    // Pay periods are for the pay period reports and calendar periods for the
    // scan reports, so moving between the two puts the dates somewhere that
    // the new report can read them.
    if (isScanReport(id) !== isScanReport(dataSource)) setDateRange(defaultRangeFor(id));
    setPreviewResult(null);
    setPreviewedWith(null);
    if (!nameTouched) setReportName(dataSourceLabel(id));
  }

  // A filter with no value picked yet is left out rather than sent: it
  // matched nothing and crashed the preview with a database error.
  const readyFilters = filters.filter(isFilterReady);
  const config = { columns: selectedColumns, filters: readyFilters, dateRange, groupBy, sortBy };
  const configKey = JSON.stringify([dataSource, config]);
  const stale = previewResult !== null && previewedWith !== configKey;
  const canPreview = selectedColumns.length > 0 && isRangeReady(dateRange);

  async function handleRunPreview(fromButton: boolean) {
    if (!canPreview) return;
    setIsRunning(true);
    setPreviewError(null);
    // Stacked on a narrow window, the preview is under the settings.
    if (fromButton && !window.matchMedia(SIDE_BY_SIDE).matches) {
      previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const result = await runReport({ dataSource, config: { ...config, limit: PREVIEW_ROWS } });
    if (result.success) {
      setPreviewResult(result.data);
      setPreviewedWith(configKey);
    } else {
      setPreviewError(result.error);
    }
    setIsRunning(false);
  }

  // The first preview runs by itself, on open and on a new type, so the page
  // never opens on an empty table. The settings it uses are this render's.
  useEffect(() => {
    void handleRunPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource]);

  /**
   * Both panes end at the bottom of the window, measured rather than
   * computed, because the space under the pinned header depends on how its
   * actions wrap. Stacked on a narrow window they take their own height.
   */
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const el = bodyRef.current;
      if (!el || !window.matchMedia(SIDE_BY_SIDE).matches) {
        setPaneHeight(null);
        return;
      }
      // Down to the bottom of whatever scrolls the page, less the padding the
      // layout keeps under the page, measured as if it were scrolled to the
      // top so the page itself never has to scroll.
      let scroller: HTMLElement | null = el.parentElement;
      let padding = 0;
      while (scroller) {
        const style = getComputedStyle(scroller);
        padding += parseFloat(style.paddingBottom) || 0;
        if (/(auto|scroll)/.test(style.overflowY)) break;
        scroller = scroller.parentElement;
      }
      const bottom = scroller
        ? scroller.getBoundingClientRect().top + scroller.clientHeight - padding
        : window.innerHeight - 16;
      const top = el.getBoundingClientRect().top + (scroller?.scrollTop ?? window.scrollY);
      const h = Math.max(480, Math.floor(bottom - top));
      setPaneHeight((prev) => (prev === h ? prev : h));
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    document.addEventListener("scroll", onChange, { capture: true, passive: true });
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      document.removeEventListener("scroll", onChange, { capture: true });
      window.removeEventListener("resize", onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  function handleSave() {
    if (!reportName.trim()) return;
    setSaveError(null);

    startTransition(async () => {
      const result = await createReport({
        name: reportName.trim(),
        description: reportDesc.trim() || undefined,
        dataSource,
        config: { ...config, limit: savedLimit(dataSource) },
        visibility: "PRIVATE",
      });

      if (result.success) {
        router.push(`/reports/${result.data.id}`);
      } else {
        setSaveError(result.error);
      }
    });
  }

  const moreCount = groupBy.length + sortBy.length;
  const summary = [
    dataSourceLabel(dataSource),
    describeRange(dateRange, filterOptions.payPeriods),
    readyFilters.length === 0
      ? "Everyone"
      : `${readyFilters.length} ${readyFilters.length === 1 ? "filter" : "filters"}`,
    `${selectedColumns.length} ${selectedColumns.length === 1 ? "column" : "columns"}`,
  ].join(" · ");

  const previewNote = !canPreview
    ? selectedColumns.length === 0
      ? "Pick at least one column to see rows."
      : "Pick both dates to see rows."
    : stale
      ? "The settings changed since this preview."
      : previewResult
        ? previewResult.rows.length >= PREVIEW_ROWS
          ? `The first ${PREVIEW_ROWS} rows. The saved report returns up to ${savedLimit(dataSource).toLocaleString("en-US")}.`
          : "Every row these settings return."
        : `The first ${PREVIEW_ROWS} rows these settings return.`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pinned
        title="New report"
        subtitle={summary}
        actions={
          <>
            <LinkButton href="/reports" hierarchy="tertiary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
              Reports
            </LinkButton>
            <Button
              hierarchy="primary"
              disabled={selectedColumns.length === 0}
              title={selectedColumns.length === 0 ? "Pick at least one column to save it" : undefined}
              onClick={() => setSaving(true)}
              leadingIcon={<Save className="h-4 w-4" />}
            >
              Save report
            </Button>
          </>
        }
      />

      <div
        ref={bodyRef}
        className="grid items-start gap-4 lg:[grid-template-columns:clamp(320px,32%,384px)_minmax(0,1fr)]"
      >
        {/* ── Settings ─────────────────────────────────────────────── */}
        <aside
          aria-label="Report settings"
          className="ta-card flex min-w-0 flex-col overflow-hidden"
          style={{ height: paneHeight ?? undefined, borderRadius: "var(--radius-l)" }}
        >
          <div className="flex items-start gap-3 px-5 py-4">
            <ReportTypeIcon id={dataSource} size={40} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className="truncate"
                style={{ font: "var(--weight-semibold) 15px/22px var(--font-sans)", color: "var(--text-primary)" }}
              >
                {dataSourceLabel(dataSource)}
              </span>
              <span
                className="line-clamp-2"
                style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                title={dataSourceDescription(dataSource)}
              >
                {dataSourceDescription(dataSource)}
              </span>
            </span>
            <Button size="sm" hierarchy="secondary" onClick={() => setChangingSource(true)}>
              Change
            </Button>
          </div>

          {currentSource && (
            <div className="ta-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
              <RailSection title="Dates" hint="You can pick other dates each time you run it.">
                <DateRangePicker value={dateRange} onChange={setDateRange} payPeriods={filterOptions.payPeriods} scan={isScanReport(dataSource)} stacked />
              </RailSection>

              <RailSection
                title="Filters"
                meta={readyFilters.length ? `${readyFilters.length} on` : undefined}
              >
                <FilterBuilder
                  filterFields={currentSource.filters}
                  filters={filters}
                  onChange={setFilters}
                  filterOptions={filterOptions}
                />
              </RailSection>

              <RailSection title="Columns" hint="What shows in the report, and in what order.">
                <ColumnPicker columns={currentSource.columns} selected={selectedColumns} onChange={setSelectedColumns} />
              </RailSection>

              <div style={{ borderTop: "1px solid var(--stroke-divider)" }}>
                <button
                  type="button"
                  className="ta-hoverable flex w-full items-start gap-3 px-5 py-4 text-left"
                  style={{ border: 0, background: "transparent", cursor: "pointer" }}
                  aria-expanded={showMore}
                  onClick={() => setShowMore((v) => !v)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="wms-overline">Group and sort</span>
                    <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                      {moreCount > 0
                        ? [
                            groupBy.length && `Grouped by ${groupBy.length}`,
                            sortBy.length && `sorted by ${sortBy.length}`,
                          ]
                            .filter(Boolean)
                            .join(", ")
                        : "Optional. Group rows by department or site, or change their order."}
                    </span>
                  </span>
                  <ChevronDown
                    className="mt-0.5 h-4 w-4 flex-none transition-transform"
                    style={{ color: "var(--icon-tertiary)", transform: showMore ? "rotate(180deg)" : undefined }}
                    aria-hidden="true"
                  />
                </button>
                {showMore && (
                  <div className="px-5 pb-5">
                    <GroupSortConfig
                      columns={currentSource.columns}
                      groupableFields={currentSource.groupableFields}
                      groupBy={groupBy}
                      onGroupByChange={setGroupBy}
                      sortBy={sortBy}
                      onSortByChange={setSortBy}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* ── Preview ──────────────────────────────────────────────── */}
        <section
          ref={previewRef}
          aria-label="Preview"
          className="ta-card flex min-w-0 flex-col overflow-hidden"
          style={{
            height: paneHeight ?? undefined,
            minHeight: paneHeight ? undefined : 420,
            borderRadius: "var(--radius-l)",
            scrollMarginTop: 96,
          }}
        >
          <header className="flex items-center gap-3 px-5 py-3.5">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>Preview</h2>
              <span
                className="truncate"
                title={previewNote}
                style={{ font: "var(--type-body2)", color: stale ? "var(--text-warning)" : "var(--text-tertiary)" }}
              >
                {previewNote}
              </span>
            </span>
            <Button
              size="sm"
              hierarchy={stale || (!previewResult && !isRunning) ? "primary" : "secondary"}
              disabled={!canPreview || isRunning}
              onClick={() => void handleRunPreview(true)}
              leadingIcon={previewResult ? <RefreshCw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            >
              {isRunning ? "Running" : stale ? "Update preview" : previewResult ? "Run again" : "Run preview"}
            </Button>
          </header>

          {previewError && (
            <div className="px-5 pb-4">
              <Banner tone="error" title="The preview did not run" body={previewError} />
            </div>
          )}

          <div
            className="flex min-h-0 flex-1 flex-col"
            style={{
              borderTop: "1px solid var(--stroke-divider)",
              opacity: stale && !isRunning ? 0.55 : 1,
              transition: "opacity 140ms ease",
            }}
          >
            {previewResult || isRunning ? (
              <ResultsTable
                columns={previewResult?.columns ?? []}
                rows={previewResult?.rows ?? []}
                totalRows={previewResult?.totalRows ?? 0}
                isLoading={isRunning}
                fill
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={<Table2 className="h-8 w-8" />}
                  title={canPreview ? "No preview yet" : selectedColumns.length === 0 ? "No columns picked" : "Dates not picked yet"}
                  body={
                    canPreview
                      ? "Run the preview to see the first rows this report returns."
                      : selectedColumns.length === 0
                        ? "Tick at least one column on the left to see rows."
                        : "Pick a start and an end date on the left to see rows."
                  }
                />
              </div>
            )}
          </div>
        </section>
      </div>

      {changingSource && (
        <ReportTypeDialog
          sources={dataSources}
          selected={dataSource}
          changing
          onPick={handleDataSourceChange}
          onClose={() => setChangingSource(false)}
        />
      )}

      {saving && (
        <SaveDialog
          name={reportName}
          description={reportDesc}
          error={saveError}
          pending={isPending}
          onName={(v) => {
            setReportName(v);
            setNameTouched(true);
          }}
          onDescription={setReportDesc}
          onSave={handleSave}
          onClose={() => {
            setSaving(false);
            setSaveError(null);
          }}
        />
      )}
    </div>
  );
}

/** A filter that has everything it needs to narrow the report. */
export function isFilterReady(f: FilterDef): boolean {
  const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
  return !blank(f.value) && (f.operator !== "between" || !blank(f.value2));
}

/** Dates the report can run on: two picked dates, or a pay period or a count of days. */
function isRangeReady(r: DateRange): boolean {
  return r.type !== "custom" || (!!r.startDate && !!r.endDate);
}

/** One group of settings in the rail: its name, what is set, then the controls. */
function RailSection({
  title,
  meta,
  hint,
  children,
}: {
  title: string;
  meta?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 px-5 py-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
      <header className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <h3 className="wms-overline min-w-0 flex-1" style={{ margin: 0 }}>
            {title}
          </h3>
          {meta && (
            <span className="tabular" style={{ font: "var(--type-caption1)", color: "var(--text-accent)" }}>
              {meta}
            </span>
          )}
        </span>
        {hint && <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{hint}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * Save: a name and an optional description, then the saved report opens.
 * Escape, Cancel and the scrim close it and keep everything on the page.
 */
function SaveDialog({
  name,
  description,
  error,
  pending,
  onName,
  onDescription,
  onSave,
  onClose,
}: {
  name: string;
  description: string;
  error: string | null;
  pending: boolean;
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const input = dialogRef.current?.querySelector<HTMLInputElement>("input");
    input?.focus();
    input?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && !pending && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-report-title"
        className="ta-modal flex w-full max-w-md flex-col"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
          <h2 id="save-report-title" className="min-w-0 flex-1" style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
            Save report
          </h2>
          <Button hierarchy="tertiary" iconOnly onClick={onClose} disabled={pending} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <form
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !pending) onSave();
          }}
        >
          <Input label="Name" required value={name} onChange={(e) => onName(e.target.value)} placeholder="Overtime by department" />
          <Textarea
            label="Description"
            rows={2}
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            placeholder="Optional. What it is for, so others know"
          />
          {error && <Banner tone="error" title="The report was not saved" body={error} />}
          <button type="submit" hidden />
        </form>
        <footer className="flex items-center gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          <span className="min-w-0 flex-1" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            Only you can see it until you share it.
          </span>
          <Button hierarchy="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button hierarchy="primary" onClick={onSave} disabled={!name.trim() || pending} leadingIcon={<Save className="h-4 w-4" />}>
            {pending ? "Saving" : "Save report"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
