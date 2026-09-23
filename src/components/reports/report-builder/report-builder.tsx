"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { ArrowLeft, Play, Save, Table2 } from "lucide-react";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  SegmentedControl,
  Textarea,
} from "@/components/ui";
import { DataSourcePicker } from "./data-source-picker";
import { ColumnPicker } from "./column-picker";
import { FilterBuilder } from "./filter-builder";
import { DateRangePicker } from "./date-range-picker";
import { GroupSortConfig } from "./group-sort-config";
import { ResultsTable } from "../report-results/results-table";
import { runReport, createReport } from "@/actions/report.actions";
import type {
  DataSourceId,
  FilterDef,
  SortDef,
  DateRange,
} from "@/lib/validators/report.schema";
import type { ReportResult } from "@/lib/reports/data-sources";

/**
 * The report builder, as the portal design's doc screen: a stack of labelled
 * cards down a narrow column, with the page's own actions in the header.
 *
 * <p>The header carries them — not a button bar at the bottom of the last tab
 * — because Save applies to the whole form and used to live inside the Preview
 * tab, where it could only be reached by running a preview first. Its two
 * prerequisites, a name and a data source, are the two things the first card
 * asks for, so the button is never disabled for a reason that is off screen.
 *
 * <p>This component owns the PageHeader rather than the route, since Preview
 * and Save both act on state that only exists here.
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

const TABS = ["Source", "Columns", "Filters", "Date Range", "Group & Sort", "Preview"] as const;
type Tab = (typeof TABS)[number];

/** The design's doc width for this screen. */
const DOC_WIDTH = 900;

export function ReportBuilder({
  dataSources,
  filterOptions,
}: {
  dataSources: DataSourceMeta[];
  filterOptions: FilterOptions;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Builder state
  const [activeTab, setActiveTab] = useState<Tab>("Source");
  const [dataSource, setDataSource] = useState<DataSourceId | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterDef[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const pp = filterOptions.payPeriods[0];
    return pp
      ? { type: "payPeriod" as const, payPeriodId: pp.id }
      : { type: "relative" as const, relativeDays: 30 };
  });
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortDef[]>([]);

  // Preview state
  const [previewResult, setPreviewResult] = useState<ReportResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Save state
  const [reportName, setReportName] = useState("");
  const [reportDesc, setReportDesc] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentSource = dataSources.find((ds) => ds.id === dataSource);

  // When data source changes, set default columns
  function handleDataSourceChange(id: DataSourceId) {
    setDataSource(id);
    const source = dataSources.find((ds) => ds.id === id);
    if (source) {
      setSelectedColumns(
        source.columns.filter((c) => c.defaultVisible).map((c) => c.id)
      );
    }
    setFilters([]);
    setGroupBy([]);
    setSortBy([]);
    setPreviewResult(null);
  }

  async function handleRunPreview() {
    if (!dataSource || selectedColumns.length === 0) return;
    setIsRunning(true);
    setPreviewError(null);

    const result = await runReport({
      dataSource,
      config: {
        columns: selectedColumns,
        filters,
        dateRange,
        groupBy,
        sortBy,
        limit: 100,
      },
    });

    if (result.success) {
      setPreviewResult(result.data);
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
        config: {
          columns: selectedColumns,
          filters,
          dateRange,
          groupBy,
          sortBy,
          limit: 5000,
        },
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

  /** What the first card says it still needs before Save will do anything. */
  const missing = [
    !reportName.trim() && "a name",
    !dataSource && "a data source",
    dataSource && selectedColumns.length === 0 && "at least one column",
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title="New Report"
        subtitle="Pick a data source, shape the columns, schedule delivery"
        actions={
          <>
            <LinkButton
              href="/reports"
              hierarchy="tertiary"
              leadingIcon={<ArrowLeft className="h-4 w-4" />}
            >
              Reports
            </LinkButton>
            <Button
              hierarchy="secondary"
              disabled={!canPreview || isRunning}
              onClick={() => {
                setActiveTab("Preview");
                void handleRunPreview();
              }}
              leadingIcon={<Play className="h-4 w-4" />}
            >
              {isRunning ? "Running…" : "Preview"}
            </Button>
            <Button
              hierarchy="primary"
              disabled={!canSave || isPending}
              onClick={handleSave}
              leadingIcon={<Save className="h-4 w-4" />}
            >
              {isPending ? "Saving…" : "Save Report"}
            </Button>
          </>
        }
      />

      {saveError && <Banner tone="error" title="The report was not saved" body={saveError} />}

      <div
        className="flex flex-col gap-4"
        // The design fixes this screen at 900px, which is right for a form and
        // wrong for a hundred-row preview, so the results tab takes the width
        // it needs rather than scrolling a table inside a narrow column.
        style={{ maxWidth: activeTab === "Preview" ? undefined : DOC_WIDTH }}
      >
        <Card
          title="Report"
          subtitle={
            missing.length > 0
              ? `Still needs ${missing.join(" and ")} before it can be saved.`
              : "Ready to save — Preview first if you want to see the rows."
          }
        >
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,46%)),1fr))]">
            <Input
              label="Report Name"
              required
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Overtime by Department"
            />
            <Textarea
              label="Description"
              rows={2}
              value={reportDesc}
              onChange={(e) => setReportDesc(e.target.value)}
              placeholder="What this report answers, and for whom"
            />
          </div>
        </Card>

        <div className="overflow-x-auto">
          <SegmentedControl
            items={TABS.map((tab) => ({ value: tab, label: tab }))}
            value={activeTab}
            onChange={(v) => setActiveTab(v as Tab)}
            ariaLabel="Builder step"
          />
        </div>

        {activeTab === "Source" && (
          <Card
            title="Data Source"
            subtitle="Decides which columns, filters and groupings the rest of this form can offer"
          >
            <DataSourcePicker
              sources={dataSources}
              selected={dataSource}
              onSelect={handleDataSourceChange}
            />
          </Card>
        )}

        {activeTab === "Columns" && (
          <Card title="Columns" subtitle="Pick what appears, in order.">
            {currentSource ? (
              <ColumnPicker
                columns={currentSource.columns}
                selected={selectedColumns}
                onChange={setSelectedColumns}
              />
            ) : (
              <NeedsSource onGo={() => setActiveTab("Source")} />
            )}
          </Card>
        )}

        {activeTab === "Filters" && (
          <Card
            title="Filters"
            subtitle="Every row narrows the report further — they are combined with AND"
          >
            {currentSource ? (
              <FilterBuilder
                filterFields={currentSource.filters}
                filters={filters}
                onChange={setFilters}
                filterOptions={filterOptions}
              />
            ) : (
              <NeedsSource onGo={() => setActiveTab("Source")} />
            )}
          </Card>
        )}

        {activeTab === "Date Range" && (
          <Card
            title="Date Range"
            subtitle="The window the report covers. A saved report can be re-run over any other window."
          >
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              payPeriods={filterOptions.payPeriods}
            />
          </Card>
        )}

        {activeTab === "Group & Sort" && (
          <Card title="Group & Sort" subtitle="How the rows are rolled up, and what order they come out in">
            {currentSource ? (
              <GroupSortConfig
                columns={currentSource.columns}
                groupableFields={currentSource.groupableFields}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                sortBy={sortBy}
                onSortByChange={setSortBy}
              />
            ) : (
              <NeedsSource onGo={() => setActiveTab("Source")} />
            )}
          </Card>
        )}

        {activeTab === "Preview" && (
          <>
            {previewError && (
              <Banner tone="error" title="The preview did not run" body={previewError} />
            )}

            <Card
              title="Preview"
              subtitle="Capped at 100 rows — a saved report runs up to 5,000"
              padding={0}
              actions={
                <Button
                  size="sm"
                  hierarchy="secondary"
                  disabled={!canPreview || isRunning}
                  onClick={handleRunPreview}
                  leadingIcon={<Play className="h-3.5 w-3.5" />}
                >
                  {isRunning ? "Running…" : "Run Preview"}
                </Button>
              }
            >
              {previewResult ? (
                <ResultsTable
                  columns={previewResult.columns}
                  rows={previewResult.rows}
                  totalRows={previewResult.totalRows}
                  isLoading={isRunning}
                />
              ) : (
                <EmptyState
                  icon={<Table2 className="h-8 w-8" />}
                  title={canPreview ? "Not previewed yet" : "Pick a data source and columns first"}
                  body={
                    canPreview
                      ? "Run the preview to see the first hundred rows this report would return."
                      : "A preview needs a data source and at least one column."
                  }
                />
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What a tab shows before a data source has been chosen.
 *
 * <p>Says which step is missing and takes you there, rather than the previous
 * grey line of text that named a prerequisite and left you to find it.
 */
function NeedsSource({ onGo }: { onGo: () => void }) {
  return (
    <EmptyState
      title="No data source yet"
      body="The columns, filters and groupings on offer depend on which table the report reads."
      action={
        <Button size="sm" hierarchy="secondary" onClick={onGo}>
          Choose a data source
        </Button>
      }
    />
  );
}
