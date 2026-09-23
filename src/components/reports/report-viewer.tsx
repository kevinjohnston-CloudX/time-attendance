"use client";

import { useState } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { format } from "date-fns";
import {
  ArrowLeft,
  Copy,
  Download,
  Play,
  Share2,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  statusTone,
} from "@/components/ui";
import { ResultsTable } from "./report-results/results-table";
import { DateRangePicker } from "./report-builder/date-range-picker";
import { ShareDialog } from "./report-list/share-dialog";
import { ScheduleForm } from "./schedule-form";
import { dataSourceLabel } from "./data-source-label";
import { runReport, deleteReport, duplicateReport } from "@/actions/report.actions";
import type { ReportResult } from "@/lib/reports/data-sources";
import type { DateRange } from "@/lib/validators/report.schema";

/**
 * A saved report, as the portal design's doc screen: the record's own title,
 * a tertiary way back, and then stacked cards — what the report is, the window
 * it will run over, the rows it produced, and how it has been delivered.
 *
 * <p>Running is the page's primary action and lives in the header, which is
 * why the date range is a card of its own rather than a strip with its own Run
 * button: there is one Run on the screen, and it always runs what the card
 * says.
 */

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
  runs: {
    id: string;
    status: string;
    startedAt: string | Date;
    rowCount: number | null;
    triggeredBy: string;
    error: string | null;
  }[];
}

interface FilterOptions {
  payPeriods: { id: string; startDate: string | Date; endDate: string | Date; status: string }[];
}

const VISIBILITY_LABEL: Record<string, string> = {
  PRIVATE: "Private",
  SHARED: "Shared",
  TENANT: "Everyone in the tenant",
};

const RUN_STATE_LABEL: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

/**
 * A run's state written in the vocabulary `statusTone` speaks.
 *
 * <p>Not a colour map: the tones still come from the shared helper. That
 * helper's vocabulary is timesheets and leave, where a finished thing is
 * RESOLVED and a started one is IN_PROGRESS — a report run calls those two
 * states COMPLETED and RUNNING, so they fall out of the helper's default
 * branch as amber, and an amber "Completed" on a payroll report reads as
 * something that needs looking at.
 */
const RUN_STATE_AS_STATUS: Record<string, string> = {
  COMPLETED: "RESOLVED",
  RUNNING: "IN_PROGRESS",
};

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: "Manual",
  SCHEDULE: "Scheduled",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getSavedDateRange(config: unknown): DateRange | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;
  if (c.dateRange && typeof c.dateRange === "object") {
    return c.dateRange as DateRange;
  }
  return null;
}

/**
 * A cron expression as a sentence.
 *
 * <p>Only the shapes the schedule form can build are translated; anything
 * hand-written falls back to the expression itself, because a wrong sentence
 * about when a payroll report goes out is worse than five numbers.
 */
function describeCron(expr: string, timezone: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hr, dom, , dow] = parts;
  const h = Number(hr);
  const m = Number(min);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return expr;
  const at = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const zone = timezoneAbbr(timezone);

  let when: string;
  if (dom === "*" && dow === "*") when = "Daily";
  else if (dom === "*" && DAY_NAMES[Number(dow)]) when = `Weekly · ${DAY_NAMES[Number(dow)]}`;
  else if (dom === "1,15" && dow === "*") when = "Twice monthly · 1st & 15th";
  else if (dow === "*" && Number.isInteger(Number(dom))) when = `Monthly · day ${Number(dom)}`;
  else return expr;

  return `${when} · ${at}${zone ? ` ${zone}` : ""}`;
}

/**
 * The short name of a timezone, asked of the platform rather than kept in a
 * table here — a second copy of the schedule form's list would be one more
 * thing to remember when a site opens in a new zone.
 */
function timezoneAbbr(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** The chosen window, in the words the picker offers it in. */
function describeRange(range: DateRange, filterOptions: FilterOptions | null): string {
  if (range.type === "relative") return `Last ${range.relativeDays} days`;
  if (range.type === "custom") {
    if (!range.startDate || !range.endDate) return "Custom range — not set";
    return `${range.startDate} – ${range.endDate}`;
  }
  const pp = filterOptions?.payPeriods.find((p) => p.id === range.payPeriodId);
  if (!pp) return "Pay period";
  return `${format(new Date(pp.startDate), "MMM d")} – ${format(new Date(pp.endDate), "MMM d, yyyy")}`;
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
        // Recipients are a JSON column, so the cast is a claim about a value
        // the database does not enforce. Anything that is not a list of
        // addresses becomes an empty one rather than crashing the screen the
        // schedule is edited from.
        recipients: Array.isArray(report.schedules[0].recipients)
          ? (report.schedules[0].recipients as string[])
          : [],
        isActive: report.schedules[0].isActive,
      }
    : undefined;

  const lastRun = report.runs[0];
  const sourceLabel = dataSourceLabel(report.dataSource);

  const subtitle = [sourceLabel, report.owner.name && `owned by ${report.owner.name}`, report.description]
    .filter(Boolean)
    .join(" · ");

  const facts: { label: string; value: string }[] = [
    { label: "Data Source", value: sourceLabel },
    { label: "Range", value: describeRange(dateRange, filterOptions) },
    {
      label: "Schedule",
      value: existingSchedule
        ? describeCron(existingSchedule.cronExpr, existingSchedule.timezone) +
          (existingSchedule.isActive ? "" : " · paused")
        : "On demand only",
    },
    {
      label: "Last Run",
      value: lastRun
        ? `${format(new Date(lastRun.startedAt), "MMM d · HH:mm")} · ${RUN_STATE_LABEL[lastRun.status] ?? lastRun.status}`
        : "Never run",
    },
    { label: "Visibility", value: VISIBILITY_LABEL[report.visibility] ?? report.visibility },
    {
      label: "Shared With",
      value:
        report.shares.length > 0
          ? report.shares.map((s) => s.user.name ?? s.user.email ?? "Unnamed").join(", ")
          : "Nobody",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title={report.name}
        subtitle={subtitle}
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
              onClick={() => setShowShareDialog(true)}
              leadingIcon={<Share2 className="h-4 w-4" />}
            >
              Share
            </Button>
            <Button
              hierarchy="primary"
              onClick={handleRun}
              disabled={isRunning}
              leadingIcon={<Play className="h-4 w-4" />}
            >
              {isRunning ? "Running…" : "Run Now"}
            </Button>
          </>
        }
      />

      {error && (
        <Banner
          tone="error"
          title="The report did not run"
          body={error}
          // Not "in the history below": the failure is written to ReportRun,
          // but nothing on this screen re-reads it, so the table underneath
          // will not show the run until the page is loaded again.
          meta="The failure is recorded against this report — reload the page to see it in the run history."
        />
      )}

      <Card
        title="Report"
        subtitle={report.isTemplate ? "A built-in template — it cannot be deleted" : undefined}
        actions={
          <>
            <Button size="sm" hierarchy="secondary" onClick={handleDuplicate} leadingIcon={<Copy className="h-3.5 w-3.5" />}>
              Duplicate
            </Button>
            {!report.isTemplate && (
              <Button
                size="sm"
                hierarchy="secondary"
                tone="error"
                onClick={handleDelete}
                leadingIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Delete
              </Button>
            )}
          </>
        }
      >
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
          {facts.map((f) => (
            <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
              <span className="wms-overline">{f.label}</span>
              <span
                className="tabular"
                style={{
                  font: "var(--weight-semibold) 16px/22px var(--font-sans)",
                  color: "var(--text-primary)",
                  overflowWrap: "anywhere",
                }}
              >
                {f.value}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Date Range" subtitle="Run Now uses this window, whatever the report was saved with">
        <DateRangePicker
          value={dateRange}
          onChange={setDateRange}
          payPeriods={filterOptions?.payPeriods ?? []}
        />
      </Card>

      <Card
        title="Results"
        subtitle={
          result
            ? `${result.totalRows.toLocaleString()} row${result.totalRows === 1 ? "" : "s"} · ${describeRange(dateRange, filterOptions)} · PDF and XLSX re-run the report's saved range`
            : "Nothing has been run on this screen yet"
        }
        padding={0}
        actions={
          result ? (
            <>
              <Button
                size="sm"
                hierarchy="secondary"
                onClick={handleExportCsv}
                leadingIcon={<Download className="h-3.5 w-3.5" />}
              >
                CSV
              </Button>
              {/* PDF and XLSX are generated server-side from the report's
                  *saved* configuration, so they ignore the range picked above.
                  Said out loud in the subtitle, because a spreadsheet covering
                  a different fortnight than the screen is a payroll number
                  nobody can reconcile. */}
              <ExportLink href={`/api/reports/${report.id}/export?format=pdf`} label="PDF" />
              <ExportLink href={`/api/reports/${report.id}/export?format=xlsx`} label="XLSX" />
            </>
          ) : undefined
        }
      >
        {result ? (
          <ResultsTable
            columns={result.columns}
            rows={result.rows}
            totalRows={result.totalRows}
            isLoading={isRunning}
          />
        ) : (
          <EmptyState
            icon={<Play className="h-8 w-8" />}
            title="Not run yet"
            body="Pick a date range above, then press Run Now. The rows appear here and can be exported."
          />
        )}
      </Card>

      <Card
        title="Run History"
        subtitle={
          existingSchedule
            ? `Last ten runs · ${describeCron(existingSchedule.cronExpr, existingSchedule.timezone)} to ${existingSchedule.recipients.length} recipient${existingSchedule.recipients.length === 1 ? "" : "s"}`
            : "Last ten runs · this report is not scheduled"
        }
        padding={0}
        actions={
          <>
            {existingSchedule && (
              <Badge tone={statusTone(existingSchedule.isActive ? "ACTIVE" : "OPEN")} size="sm">
                {existingSchedule.isActive ? "Active" : "Paused"}
              </Badge>
            )}
            <Button size="sm" hierarchy="secondary" onClick={() => setShowScheduleForm(true)}>
              {existingSchedule ? "Edit Schedule" : "Schedule"}
            </Button>
          </>
        }
      >
        {report.runs.length === 0 ? (
          <EmptyState
            title="No runs recorded"
            body="Every run from this screen and every scheduled delivery is listed here with the rows it returned."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Run</TH>
                <TH>Trigger</TH>
                <TH numeric>Rows</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {report.runs.map((run) => (
                <TR key={run.id}>
                  {/* Tabular figures: this column is read down, to find the run
                      somebody is asking about. */}
                  <TD numeric align="left">
                    {format(new Date(run.startedAt), "MMM d · HH:mm")}
                  </TD>
                  <TD style={{ color: "var(--text-secondary)" }}>
                    {TRIGGER_LABEL[run.triggeredBy] ?? run.triggeredBy}
                  </TD>
                  <TD numeric style={{ color: "var(--text-secondary)" }}>
                    {run.rowCount ?? "—"}
                  </TD>
                  <TD>
                    <div className="flex min-w-0 flex-col gap-0.5 py-1.5">
                      <Badge
                        tone={statusTone(RUN_STATE_AS_STATUS[run.status] ?? run.status)}
                        size="sm"
                      >
                        {RUN_STATE_LABEL[run.status] ?? run.status}
                      </Badge>
                      {/* A failed run with no reason on the row is a support
                          ticket. The reason is already stored; it was just
                          never shown. */}
                      {run.error && (
                        <span
                          style={{
                            font: "var(--type-body2)",
                            color: "var(--text-error)",
                            textWrap: "pretty",
                          }}
                        >
                          {run.error}
                        </span>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

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

/**
 * A server-generated export.
 *
 * <p>Stays a plain anchor rather than a LinkButton: the file streams out of an
 * API route, so there is no page for the router to prefetch or transition to,
 * and a new tab leaves the results on screen behind the download. It borrows
 * the secondary button's palette variables so it hovers like the real thing.
 */
function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Download ${label}`}
      className="wms-btn inline-flex h-6 flex-none items-center gap-1.5 rounded-md px-2.5"
      style={{
        ["--bg" as string]: "var(--surface-card)",
        ["--bg-h" as string]: "var(--fill-hover)",
        ["--bg-a" as string]: "var(--fill-pressed)",
        ["--fg" as string]: "var(--text-primary)",
        ["--fg-h" as string]: "var(--text-primary)",
        border: "1px solid var(--stroke-default)",
        font: "var(--type-button2)",
        textDecoration: "none",
      }}
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
