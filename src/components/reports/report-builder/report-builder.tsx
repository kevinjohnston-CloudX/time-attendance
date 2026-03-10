"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Save, Play } from "lucide-react";

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

const btnPrimary =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const btnSecondary =
  "rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";

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

  return (
    <div>
      {/* Tab navigation */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-700">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-zinc-900 text-zinc-900 dark:border-white dark:text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[300px]">
        {activeTab === "Source" && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Choose a data source
            </h2>
            <DataSourcePicker
              sources={dataSources}
              selected={dataSource}
              onSelect={handleDataSourceChange}
            />
          </div>
        )}

        {activeTab === "Columns" && currentSource && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Select columns for {currentSource.label}
            </h2>
            <ColumnPicker
              columns={currentSource.columns}
              selected={selectedColumns}
              onChange={setSelectedColumns}
            />
          </div>
        )}

        {activeTab === "Filters" && currentSource && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Filter data
            </h2>
            <FilterBuilder
              filterFields={currentSource.filters}
              filters={filters}
              onChange={setFilters}
              filterOptions={filterOptions}
            />
          </div>
        )}

        {activeTab === "Date Range" && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Select date range
            </h2>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              payPeriods={filterOptions.payPeriods}
            />
          </div>
        )}

        {activeTab === "Group & Sort" && currentSource && (
          <GroupSortConfig
            columns={currentSource.columns}
            groupableFields={currentSource.groupableFields}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            sortBy={sortBy}
            onSortByChange={setSortBy}
          />
        )}

        {activeTab === "Preview" && (
          <div className="space-y-4">
            {/* Run button */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleRunPreview}
                disabled={!canPreview || isRunning}
                className={btnPrimary + " flex items-center gap-2"}
              >
                <Play className="h-4 w-4" />
                {isRunning ? "Running..." : "Run Preview"}
              </button>
              {previewResult && (
                <span className="text-xs text-zinc-500">
                  Showing up to 100 rows
                </span>
              )}
            </div>

            {previewError && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
                {previewError}
              </div>
            )}

            {previewResult && (
              <ResultsTable
                columns={previewResult.columns}
                rows={previewResult.rows}
                totalRows={previewResult.totalRows}
              />
            )}

            {/* Save section */}
            <div className="mt-6 border-t border-zinc-200 pt-6 dark:border-zinc-700">
              <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Save this report
              </h3>
              <div className="flex flex-col gap-3 sm:max-w-md">
                <input
                  type="text"
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  placeholder="Report name"
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
                <textarea
                  value={reportDesc}
                  onChange={(e) => setReportDesc(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                />
                {saveError && (
                  <p className="text-sm text-red-600">{saveError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!reportName.trim() || !canPreview || isPending}
                    className={btnPrimary + " flex items-center gap-2"}
                  >
                    <Save className="h-4 w-4" />
                    {isPending ? "Saving..." : "Save Report"}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/reports")}
                    className={btnSecondary}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Show prompt if tab needs data source but none selected */}
        {!currentSource && activeTab !== "Source" && activeTab !== "Date Range" && activeTab !== "Preview" && (
          <div className="flex items-center justify-center py-12 text-sm text-zinc-400">
            Please select a data source first
          </div>
        )}
      </div>
    </div>
  );
}
