"use client";

import { createElement, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { ArrowLeft, ChevronDown, Play, RefreshCw, Save, Table2 } from "lucide-react";
import { Banner, Button, EmptyState, Input, LinkButton, PageHeader, Textarea } from "@/components/ui";
import { DataSourcePicker } from "./data-source-picker";
import { ColumnPicker } from "./column-picker";
import { FilterBuilder } from "./filter-builder";
import { DateRangePicker, defaultPayPeriodRange } from "./date-range-picker";
import { GroupSortConfig } from "./group-sort-config";
import { ResultsTable } from "../report-results/results-table";
import { dataSourceDescription, dataSourceIcon, dataSourceLabel } from "../data-source-label";
import { runReport, createReport } from "@/actions/report.actions";
import type { DataSourceId, FilterDef, SortDef, DateRange } from "@/lib/validators/report.schema";
import type { ReportResult } from "@/lib/reports/data-sources";

/**
 * The report builder: one page that reads top to bottom, in the order a
 * person thinks about a report. Which report, which dates, who to include,
 * which columns, then a preview and a name to save it under.
 *
 * <p>It replaces six tabs, where Save sat above everything and the preview
 * was a tab of its own, so nobody could see the settings and the rows at the
 * same time. Group and sort are folded away, since most reports never need
 * them.
 *
 * <p>Until a report is picked only the first section shows: everything
 * below it depends on which report it is.
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
}

/** The page's width: a form reads best narrow. The preview table scrolls inside it. */
const DOC_WIDTH = 960;

export function ReportBuilder({
  dataSources,
  filterOptions,
  initialSource = null,
}: {
  dataSources: DataSourceMeta[];
  filterOptions: FilterOptions;
  /** The report a Standard reports card was opened on, already picked. */
  initialSource?: DataSourceId | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const previewRef = useRef<HTMLElement | null>(null);

  const defaultsFor = (id: DataSourceId | null) =>
    dataSources.find((ds) => ds.id === id)?.columns.filter((c) => c.defaultVisible).map((c) => c.id) ?? [];

  const [dataSource, setDataSource] = useState<DataSourceId | null>(initialSource);
  const [changingSource, setChangingSource] = useState(!initialSource);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => defaultsFor(initialSource));
  const [filters, setFilters] = useState<FilterDef[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>(
    () => defaultPayPeriodRange(filterOptions.payPeriods) ?? { type: "relative", relativeDays: 14 }
  );
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortDef[]>([]);
  const [showMore, setShowMore] = useState(false);

  const [previewResult, setPreviewResult] = useState<ReportResult | null>(null);
  const [previewedWith, setPreviewedWith] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // A name is filled in from the report picked, and follows it when the
  // report changes, until somebody types their own.
  const [reportName, setReportName] = useState(() => (initialSource ? dataSourceLabel(initialSource) : ""));
  const [nameTouched, setNameTouched] = useState(false);
  const [reportDesc, setReportDesc] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentSource = dataSources.find((ds) => ds.id === dataSource);

  function handleDataSourceChange(id: DataSourceId) {
    setDataSource(id);
    setChangingSource(false);
    setSelectedColumns(defaultsFor(id));
    setFilters([]);
    setGroupBy([]);
    setSortBy([]);
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

  async function handleRunPreview() {
    if (!dataSource || selectedColumns.length === 0) return;
    setIsRunning(true);
    setPreviewError(null);
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    const result = await runReport({ dataSource, config: { ...config, limit: 100 } });
    if (result.success) {
      setPreviewResult(result.data);
      setPreviewedWith(configKey);
    } else {
      setPreviewError(result.error);
    }
    setIsRunning(false);
  }

  function handleSave() {
    if (!dataSource || !reportName.trim()) return;
    setSaveError(null);

    startTransition(async () => {
      const result = await createReport({
        name: reportName.trim(),
        description: reportDesc.trim() || undefined,
        dataSource,
        config: { ...config, limit: 5000 },
        visibility: "PRIVATE",
      });

      if (result.success) {
        router.push(`/reports/${result.data.id}`);
      } else {
        setSaveError(result.error);
      }
    });
  }

  const canPreview = !!dataSource && selectedColumns.length > 0;
  const canSave = canPreview && reportName.trim().length > 0;
  const saveHint = !dataSource
    ? "Pick a report first."
    : selectedColumns.length === 0
      ? "Pick at least one column to save it."
      : !reportName.trim()
        ? "Give it a name to save it."
        : "Only you can see it until you share it.";

  const moreCount = groupBy.length + sortBy.length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pinned
        title="New report"
        subtitle="Choose what it covers, check the preview, then save it to run again"
        actions={
          <>
            <LinkButton href="/reports" hierarchy="tertiary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
              Reports
            </LinkButton>
            <Button
              hierarchy="secondary"
              disabled={!canPreview || isRunning}
              onClick={() => void handleRunPreview()}
              leadingIcon={<Play className="h-4 w-4" />}
            >
              {isRunning ? "Running" : "Preview"}
            </Button>
            <Button
              hierarchy="primary"
              disabled={!canSave || isPending}
              onClick={handleSave}
              leadingIcon={<Save className="h-4 w-4" />}
            >
              {isPending ? "Saving" : "Save report"}
            </Button>
          </>
        }
      />

      <div className="flex w-full flex-col gap-4" style={{ maxWidth: DOC_WIDTH }}>
        {saveError && <Banner tone="error" title="The report was not saved" body={saveError} />}

        {/* ── 1. Report ─────────────────────────────────────────────── */}
        <Section
          step={1}
          title="Report"
          subtitle={
            changingSource && dataSource
              ? "Picking a different report starts the columns and filters over."
              : changingSource
                ? "Each one covers different information. Pick the one that answers your question."
                : undefined
          }
          action={
            dataSource && !changingSource ? (
              <Button size="sm" hierarchy="secondary" onClick={() => setChangingSource(true)}>
                Change
              </Button>
            ) : dataSource ? (
              <Button size="sm" hierarchy="tertiary" onClick={() => setChangingSource(false)}>
                Keep {dataSourceLabel(dataSource)}
              </Button>
            ) : undefined
          }
        >
          {changingSource || !dataSource ? (
            <DataSourcePicker sources={dataSources} selected={dataSource} onSelect={handleDataSourceChange} />
          ) : (
            (
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg"
                  style={{ background: "var(--surface-info)", color: "var(--icon-accent)" }}
                  aria-hidden="true"
                >
                  {createElement(dataSourceIcon(dataSource), { className: "h-[18px] w-[18px]" })}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                    {dataSourceLabel(dataSource)}
                  </span>
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    {dataSourceDescription(dataSource)}
                  </span>
                </span>
              </div>
            )
          )}
        </Section>

        {currentSource && (
          <>
            {/* ── 2. Dates ──────────────────────────────────────────── */}
            <Section step={2} title="Dates" subtitle="The days it covers. You can pick other dates each time you run it.">
              <DateRangePicker value={dateRange} onChange={setDateRange} payPeriods={filterOptions.payPeriods} />
            </Section>

            {/* ── 3. Who to include ─────────────────────────────────── */}
            <Section step={3} title="Who to include" subtitle="Leave this empty to include everyone. Add a filter to narrow it down.">
              <FilterBuilder
                filterFields={currentSource.filters}
                filters={filters}
                onChange={setFilters}
                filterOptions={filterOptions}
              />
            </Section>

            {/* ── 4. Columns ────────────────────────────────────────── */}
            <Section step={4} title="Columns" subtitle="What shows in the report, in this order.">
              <ColumnPicker columns={currentSource.columns} selected={selectedColumns} onChange={setSelectedColumns} />
            </Section>

            {/* ── Group and sort, folded away ───────────────────────── */}
            <section style={card}>
              <button
                type="button"
                className="ta-hoverable flex w-full items-start gap-3 px-5 py-4 text-left"
                style={{ border: 0, background: "transparent", cursor: "pointer", borderRadius: "var(--radius-l)" }}
                aria-expanded={showMore}
                onClick={() => setShowMore((v) => !v)}
              >
                <StepNumber step={5} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>Group and sort</span>
                  <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                    {moreCount > 0
                      ? [groupBy.length && `Grouped by ${groupBy.length}`, sortBy.length && `sorted by ${sortBy.length}`]
                          .filter(Boolean)
                          .join(", ")
                      : "Optional. Group rows by department or site, or change their order."}
                  </span>
                </span>
                <ChevronDown
                  className="mt-1 h-4 w-4 flex-none transition-transform"
                  style={{ color: "var(--icon-tertiary)", transform: showMore ? "rotate(180deg)" : undefined }}
                  aria-hidden="true"
                />
              </button>
              {showMore && (
                <div className="px-5 pb-5 pl-[3.75rem]" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
                  <div className="pt-4">
                    <GroupSortConfig
                      columns={currentSource.columns}
                      groupableFields={currentSource.groupableFields}
                      groupBy={groupBy}
                      onGroupByChange={setGroupBy}
                      sortBy={sortBy}
                      onSortByChange={setSortBy}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* ── 5. Preview ────────────────────────────────────────── */}
            <section ref={previewRef} style={{ ...card, scrollMarginTop: 120 }} className="flex flex-col overflow-hidden">
              <SectionHead
                step={6}
                title="Preview"
                subtitle={
                  stale
                    ? "You changed something since this preview. Run it again to see the new rows."
                    : "The first 100 rows. A saved report can return up to 5,000."
                }
                subtitleTone={stale ? "warning" : undefined}
                action={
                  <Button
                    size="sm"
                    hierarchy={previewResult && !stale ? "secondary" : "primary"}
                    disabled={!canPreview || isRunning}
                    onClick={() => void handleRunPreview()}
                    leadingIcon={previewResult ? <RefreshCw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  >
                    {isRunning ? "Running" : previewResult ? "Run again" : "Run preview"}
                  </Button>
                }
              />
              {previewError && (
                <div className="px-5 pb-4">
                  <Banner tone="error" title="The preview did not run" body={previewError} />
                </div>
              )}
              <div style={{ borderTop: "1px solid var(--stroke-divider)" }}>
                {previewResult || isRunning ? (
                  <ResultsTable
                    columns={previewResult?.columns ?? []}
                    rows={previewResult?.rows ?? []}
                    totalRows={previewResult?.totalRows ?? 0}
                    isLoading={isRunning}
                  />
                ) : (
                  <EmptyState
                    icon={<Table2 className="h-8 w-8" />}
                    title={canPreview ? "See it before you save it" : "Pick at least one column"}
                    body={
                      canPreview
                        ? "Run the preview to see the first rows this report returns."
                        : "The preview needs at least one column to show."
                    }
                  />
                )}
              </div>
            </section>

            {/* ── 6. Save ───────────────────────────────────────────── */}
            <Section step={7} title="Save" subtitle="Saved reports are listed on Reports, where you can run, share or schedule them.">
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(220px,46%)),1fr))]">
                  <Input
                    label="Name"
                    required
                    value={reportName}
                    onChange={(e) => {
                      setReportName(e.target.value);
                      setNameTouched(true);
                    }}
                    placeholder="Overtime by department"
                  />
                  <Textarea
                    label="Description"
                    rows={2}
                    value={reportDesc}
                    onChange={(e) => setReportDesc(e.target.value)}
                    placeholder="Optional. What it is for, so others know"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    hierarchy="primary"
                    disabled={!canSave || isPending}
                    onClick={handleSave}
                    leadingIcon={<Save className="h-4 w-4" />}
                  >
                    {isPending ? "Saving" : "Save report"}
                  </Button>
                  <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>{saveHint}</span>
                </div>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

/** A filter that has everything it needs to narrow the report. */
export function isFilterReady(f: FilterDef): boolean {
  const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
  return !blank(f.value) && (f.operator !== "between" || !blank(f.value2));
}

const card = {
  background: "var(--surface-card)",
  borderRadius: "var(--radius-l)",
  boxShadow: "var(--shadow-card)",
} as const;

/** A numbered section of the builder: the step, its name, one quiet line, then its controls. */
function Section({
  step,
  title,
  subtitle,
  action,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={card} className="flex flex-col">
      <SectionHead step={step} title={title} subtitle={subtitle} action={action} />
      <div className="px-5 pb-5 pl-[3.75rem]">{children}</div>
    </section>
  );
}

function SectionHead({
  step,
  title,
  subtitle,
  subtitleTone,
  action,
}: {
  step: number;
  title: string;
  subtitle?: string;
  subtitleTone?: "warning";
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start gap-3 px-5 pb-3 pt-4">
      <StepNumber step={step} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>{title}</h2>
        {subtitle && (
          <span
            style={{
              font: "var(--type-body2)",
              color: subtitleTone === "warning" ? "var(--text-warning)" : "var(--text-tertiary)",
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {action && <span className="flex-none">{action}</span>}
    </header>
  );
}

function StepNumber({ step }: { step: number }) {
  return (
    <span
      className="tabular mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full"
      style={{
        background: "var(--surface-secondary)",
        color: "var(--text-secondary)",
        font: "var(--type-caption1)",
        fontWeight: "var(--weight-semibold)",
      }}
      aria-hidden="true"
    >
      {step}
    </span>
  );
}
