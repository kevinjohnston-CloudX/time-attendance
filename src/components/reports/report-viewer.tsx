"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResultsTable } from "./report-results/results-table";
import { DateRangePicker } from "./report-builder/date-range-picker";
import { ShareDialog } from "./report-list/share-dialog";
import { ScheduleForm } from "./schedule-form";
import { runReport, deleteReport, duplicateReport } from "@/actions/report.actions";
import type { ReportResult } from "@/lib/reports/data-sources";
import type { DateRange } from "@/lib/validators/report.schema";
import {
  Play,
  Download,
  Trash2,
  Copy,
  ArrowLeft,
  Share2,
  Clock,
} from "lucide-react";
import Link from "next/link";

const SOURCE_LABELS: Record<string, string> = {
  HOURS_SUMMARY: "Hours Summary",
  ATTENDANCE_DETAIL: "Attendance Detail",
  LEAVE_SUMMARY: "Leave Summary",
  LEAVE_BALANCE: "Leave Balances",
  PUNCH_AUDIT: "Punch Audit",
  EXCEPTION_REPORT: "Exception Report",
};

interface ReportData {
  id: string;
  name: string;
  description: string | null;
  dataSource: string;
  config: unknown;
  visibility: string;
  isTemplate: boolean;
  owner: { id: string; name: string | null };
  shares: { id: string; user: { id: string; name: string | null; email: string | null }; canEdit: boolean }[];
  schedules: { id: string; cronExpr: string; isActive: boolean; format: string; recipients: unknown; timezone: string }[];
  runs: { id: string; status: string; startedAt: string | Date; rowCount: number | null }[];
}

interface FilterOptions {
  payPeriods: { id: string; startDate: string | Date; endDate: string | Date; status: string }[];
}

const btnPrimary =
  "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const btnSecondary =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";
const btnDanger =
  "rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30";

function getSavedDateRange(config: unknown): DateRange | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (c.dateRange && typeof c.dateRange === "object") {
    return c.dateRange as DateRange;
  }
  return null;
}

export function ReportViewer({
  report,
  filterOptions,
  tenantUsers,
}: {
  report: ReportData;
  filterOptions: FilterOptions | null;
  tenantUsers?: { id: string; name: string | null; email: string | null }[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<ReportResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);

  // Initialize date range from saved config, or default to most recent pay period
  const savedDateRange = getSavedDateRange(report.config);
  const defaultDateRange: DateRange = savedDateRange
    ?? (filterOptions?.payPeriods[0]
      ? { type: "payPeriod" as const, payPeriodId: filterOptions.payPeriods[0].id }
      : { type: "relative" as const, relativeDays: 30 });

  const [dateRange, setDateRange] = useState<DateRange>(defaultDateRange);

  async function handleRun() {
    setIsRunning(true);
    setError(null);
    const res = await runReport({
      reportId: report.id,
      dateRangeOverride: dateRange,
    });
    if (res.success) {
      setResult(res.data);
    } else {
      setError(res.error);
    }
    setIsRunning(false);
  }

  async function handleDuplicate() {
    const name = prompt("Name for the copy:", `${report.name} (Copy)`);
    if (!name) return;
    const res = await duplicateReport({ id: report.id, name });
    if (res.success) {
      router.push(`/reports/${res.data.id}`);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${report.name}"? This cannot be undone.`)) return;
    const res = await deleteReport({ id: report.id });
    if (res.success) {
      router.push("/reports");
    }
  }

  function handleExportCsv() {
    if (!result) return;
    const headers = result.columns.map((c) => c.label);
    const csvRows = result.rows.map((row) =>
      result.columns
        .map((col) => {
          const val = row[col.id];
          const str = val === null || val === undefined ? "" : String(val);
          return str.includes(",") || str.includes('"')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(",")
    );
    const csv = [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.name.replace(/[^a-z0-9]/gi, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const existingSchedule = report.schedules[0]
    ? {
        id: report.schedules[0].id,
        cronExpr: report.schedules[0].cronExpr,
        timezone: report.schedules[0].timezone,
        format: report.schedules[0].format,
        recipients: report.schedules[0].recipients as string[],
        isActive: report.schedules[0].isActive,
      }
    : undefined;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/reports"
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          All Reports
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
              {report.name}
            </h1>
            {report.description && (
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {report.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {SOURCE_LABELS[report.dataSource] ?? report.dataSource}
              </span>
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {report.visibility}
              </span>
              {report.owner.name && (
                <span className="text-xs text-zinc-400">
                  by {report.owner.name}
                </span>
              )}
              {existingSchedule && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  existingSchedule.isActive
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}>
                  {existingSchedule.isActive ? "Scheduled" : "Schedule paused"}
                </span>
              )}
            </div>
          </div>

          {/* Actions (non-run) */}
          <div className="flex flex-shrink-0 gap-2">
            {result && (
              <>
                <button
                  onClick={handleExportCsv}
                  className={btnSecondary + " flex items-center gap-1.5"}
                >
                  <Download className="h-4 w-4" />
                  CSV
                </button>
                <a
                  href={`/api/reports/${report.id}/export?format=pdf`}
                  className={btnSecondary + " flex items-center gap-1.5"}
                >
                  PDF
                </a>
                <a
                  href={`/api/reports/${report.id}/export?format=xlsx`}
                  className={btnSecondary + " flex items-center gap-1.5"}
                >
                  XLSX
                </a>
              </>
            )}
            <button
              onClick={() => setShowShareDialog(true)}
              className={btnSecondary + " flex items-center gap-1.5"}
              title="Share"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowScheduleForm(true)}
              className={btnSecondary + " flex items-center gap-1.5"}
              title="Schedule"
            >
              <Clock className="h-4 w-4" />
            </button>
            <button
              onClick={handleDuplicate}
              className={btnSecondary + " flex items-center gap-1.5"}
              title="Duplicate"
            >
              <Copy className="h-4 w-4" />
            </button>
            {!report.isTemplate && (
              <button
                onClick={handleDelete}
                className={btnDanger + " flex items-center gap-1.5"}
                title="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Date Range + Run */}
      <div className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
        <div className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Select date range and run
        </div>
        <div className="flex items-end gap-4">
          <div className="min-w-0 flex-1">
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              payPeriods={filterOptions?.payPeriods ?? []}
            />
          </div>
          <button
            onClick={handleRun}
            disabled={isRunning}
            className={btnPrimary + " flex flex-shrink-0 items-center gap-1.5"}
          >
            <Play className="h-4 w-4" />
            {isRunning ? "Running..." : "Run Report"}
          </button>
        </div>
      </div>

      {/* Shared with */}
      {report.shares.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Share2 className="h-3.5 w-3.5" />
          Shared with: {report.shares.map((s) => s.user.name ?? s.user.email).join(", ")}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {result ? (
        <ResultsTable
          columns={result.columns}
          rows={result.rows}
          totalRows={result.totalRows}
          isLoading={isRunning}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Choose a date range above and click <strong>Run Report</strong>.
          </p>
        </div>
      )}

      {/* Run History */}
      {report.runs.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Run History
          </h2>
          <div className="space-y-1">
            {report.runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-4 rounded-lg px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    run.status === "COMPLETED"
                      ? "bg-green-500"
                      : run.status === "FAILED"
                        ? "bg-red-500"
                        : "bg-amber-500"
                  }`}
                />
                <span>
                  {new Date(run.startedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span>{run.status}</span>
                {run.rowCount !== null && <span>{run.rowCount} rows</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Share Dialog */}
      {showShareDialog && (
        <ShareDialog
          reportId={report.id}
          reportName={report.name}
          visibility={report.visibility}
          shares={report.shares}
          tenantUsers={tenantUsers ?? []}
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {/* Schedule Form */}
      {showScheduleForm && (
        <ScheduleForm
          reportId={report.id}
          existingSchedule={existingSchedule}
          onClose={() => setShowScheduleForm(false)}
          onSaved={() => {
            setShowScheduleForm(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
