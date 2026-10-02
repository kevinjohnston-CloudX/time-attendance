"use client";

import { createElement, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { format } from "date-fns";
import { ArrowLeft, Copy, Download, Mail, Pause, Play, Share2, Trash2, X } from "lucide-react";
import { Badge, Banner, Button, EmptyState, Input, LinkButton, PageHeader } from "@/components/ui";
import { ResultsTable } from "./report-results/results-table";
import { DateRangePicker, defaultPayPeriodRange, describeRange, type PayPeriodOption } from "./report-builder/date-range-picker";
import { ShareDialog } from "./report-list/share-dialog";
import { ScheduleForm } from "./schedule-form";
import { describeSchedule } from "@/lib/reports/schedule-words";
import { dataSourceIcon, dataSourceLabel, isScanReport } from "./data-source-label";
import { runReport, deleteReport, duplicateReport, toggleSchedule } from "@/actions/report.actions";
import type { ReportResult } from "@/lib/reports/data-sources";
import type { DateRange, FilterDef } from "@/lib/validators/report.schema";

/**
 * A saved report: pick the dates, run it, download it; below, what it is,
 * who gets it by email, and every time it has run.
 *
 * <p>Run is the page's one primary action and sits in the header, over the
 * dates it will use. Downloads use those same dates, so the file always
 * matches the screen; they used to re-run the saved dates whatever was
 * picked, which the page had to warn about.
 *
 * <p>What this person may change comes from the server (`access`): only the
 * owner, or someone it is shared with for editing, sees Share, the schedule
 * controls and Delete. The actions check the same rule again.
 */

interface ReportData {
  id: string;
  name: string;
  description: string | null;
  dataSource: string;
  config: unknown;
  visibility: string;
  isTemplate: boolean;
  updatedAt?: string | Date;
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
  access?: { isOwner: boolean; canEdit: boolean };
}

interface SourceMeta {
  columns: { id: string; label: string }[];
  filters: { id: string; label: string; options?: { value: string; label: string }[] }[];
}

interface FilterOptions {
  payPeriods: PayPeriodOption[];
  sites?: { id: string; name: string }[];
  departments?: { id: string; name: string }[];
  leaveTypes?: { id: string; name: string }[];
}

const WHO_CAN_OPEN: Record<string, string> = {
  PRIVATE: "Only the owner and the people it is shared with",
  SHARED: "The people it is shared with",
  TENANT: "Everyone in the company who uses Reports",
};

const RUN_RESULT: Record<string, { label: string; tone: "success" | "error" | "info" | "neutral" }> = {
  COMPLETED: { label: "Finished", tone: "success" },
  FAILED: { label: "Failed", tone: "error" },
  RUNNING: { label: "Running", tone: "info" },
  PENDING: { label: "Waiting", tone: "neutral" },
};

const HOW_RUN: Record<string, string> = { MANUAL: "Run by hand", SCHEDULE: "Emailed on schedule" };

const OPERATOR_WORDS: Record<string, string> = {
  eq: "is",
  in: "is",
  neq: "is not",
  notIn: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  contains: "contains",
};

const FORMAT_NAME: Record<string, string> = { xlsx: "Excel", csv: "CSV", pdf: "PDF" };

function savedConfig(config: unknown): { dateRange?: DateRange; filters?: FilterDef[]; columns?: string[]; groupBy?: string[] } {
  return config && typeof config === "object" ? (config as Record<string, never>) : {};
}

export function ReportViewer({
  report,
  filterOptions,
  tenantUsers,
  source,
}: {
  report: ReportData;
  filterOptions: FilterOptions | null;
  tenantUsers?: { id: string; name: string | null; email: string | null }[];
  /** The report type's columns and filters, to put its settings in words. */
  source?: SourceMeta | null;
}) {
  const router = useRouter();
  const [isToggling, startToggle] = useTransition();
  const [result, setResult] = useState<ReportResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"share" | "schedule" | "copy" | "delete" | null>(null);

  const payPeriods = filterOptions?.payPeriods ?? [];
  const cfg = savedConfig(report.config);
  const [dateRange, setDateRange] = useState<DateRange>(
    () => cfg.dateRange ?? defaultPayPeriodRange(payPeriods) ?? { type: "relative", relativeDays: 14 }
  );
  const [ranWith, setRanWith] = useState<string | null>(null);
  const stale = result !== null && ranWith !== JSON.stringify(dateRange);

  const canEdit = report.access?.canEdit ?? false;
  const isOwner = report.access?.isOwner ?? false;
  const sourceLabel = dataSourceLabel(report.dataSource);
  const schedule = report.schedules[0];
  const recipients = schedule && Array.isArray(schedule.recipients) ? (schedule.recipients as string[]) : [];

  async function handleRun() {
    setIsRunning(true);
    setError(null);
    const res = await runReport({ reportId: report.id, dateRangeOverride: dateRange });
    if (res.success) {
      setResult(res.data);
      setRanWith(JSON.stringify(dateRange));
    } else {
      setError(res.error);
    }
    setIsRunning(false);
    // The run is recorded either way; this brings it into the history below.
    router.refresh();
  }

  const exportHref = (fmt: "xlsx" | "csv" | "pdf") =>
    `/api/reports/${report.id}/export?format=${fmt}&range=${encodeURIComponent(JSON.stringify(dateRange))}`;

  const ownerText = isOwner ? "Yours" : `Owned by ${report.owner.name ?? "someone else"}`;

  // ── Settings in words ────────────────────────────────────────────────
  const columnNames = (cfg.columns ?? [])
    .map((id) => source?.columns.find((c) => c.id === id)?.label ?? id)
    .filter(Boolean);
  const valueName = (fieldId: string, value: unknown): string => {
    const field = source?.filters.find((f) => f.id === fieldId);
    const v = String(value ?? "");
    const fromOptions = field?.options?.find((o) => o.value === v)?.label;
    if (fromOptions) return fromOptions;
    if (fieldId === "siteId") return filterOptions?.sites?.find((x) => x.id === v)?.name ?? v;
    if (fieldId === "departmentId") return filterOptions?.departments?.find((x) => x.id === v)?.name ?? v;
    if (fieldId === "leaveTypeId") return filterOptions?.leaveTypes?.find((x) => x.id === v)?.name ?? v;
    if (value === true || v === "true") return "Yes";
    if (value === false || v === "false") return "No";
    return v;
  };
  const filterWords = (cfg.filters ?? []).map((f) => {
    const label = source?.filters.find((x) => x.id === f.field)?.label ?? f.field;
    const op = OPERATOR_WORDS[f.operator] ?? f.operator;
    const tail = f.operator === "between" ? ` and ${valueName(f.field, f.value2)}` : "";
    return `${label} ${op} ${valueName(f.field, f.value)}${tail}`;
  });
  const groupWords = (cfg.groupBy ?? []).map((id) => source?.columns.find((c) => c.id === id)?.label ?? id);

  const details: { label: string; value: ReactNode }[] = [
    { label: "Type", value: sourceLabel },
    {
      label: "Columns",
      value: columnNames.length ? columnNames.join(", ") : "None",
    },
    { label: "Who is included", value: filterWords.length ? filterWords.join(". ") : "Everyone in the dates" },
    ...(groupWords.length ? [{ label: "Grouped by", value: groupWords.join(", then ") }] : []),
    { label: "Saved dates", value: describeRange(cfg.dateRange, payPeriods) },
    { label: "Owner", value: isOwner ? "You" : report.owner.name ?? "Unknown" },
    {
      label: "Who can open it",
      value:
        WHO_CAN_OPEN[report.visibility] +
        (report.shares.length
          ? `: ${report.shares.map((s) => s.user.name ?? s.user.email ?? "Unnamed").join(", ")}`
          : ""),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        pinned
        title={report.name}
        subtitle={[sourceLabel, ownerText, report.description].filter(Boolean).join(" · ")}
        actions={
          <>
            <LinkButton href="/reports" hierarchy="tertiary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
              Reports
            </LinkButton>
            {canEdit && (
              <Button hierarchy="secondary" onClick={() => setDialog("share")} leadingIcon={<Share2 className="h-4 w-4" />}>
                Share
              </Button>
            )}
            <Button hierarchy="primary" onClick={() => void handleRun()} disabled={isRunning} leadingIcon={<Play className="h-4 w-4" />}>
              {isRunning ? "Running" : "Run report"}
            </Button>
          </>
        }
      />

      {error && (
        <Banner
          tone="error"
          title="The report did not run"
          body="Nothing was changed. Try again, or pick different dates. The failed run is listed in the run history."
          meta={error}
        />
      )}

      {/* ── Dates ───────────────────────────────────────────────────── */}
      <Panel
        title="Dates"
        subtitle="Run report and the downloads use these dates. The report keeps its saved dates for next time."
      >
        <DateRangePicker value={dateRange} onChange={setDateRange} payPeriods={payPeriods} scan={isScanReport(report.dataSource)} />
      </Panel>

      {/* ── Results ─────────────────────────────────────────────────── */}
      <Panel
        title="Results"
        flush
        subtitle={
          stale
            ? "You changed the dates. Run the report again to see the new rows."
            : result
              ? `${result.totalRows.toLocaleString("en-US")} ${result.totalRows === 1 ? "row" : "rows"} · ${describeRange(dateRange, payPeriods)}`
              : "Run the report to see the rows here."
        }
        subtitleTone={stale ? "warning" : undefined}
        action={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              Download
            </span>
            <DownloadLink href={exportHref("xlsx")} label="Excel" />
            <DownloadLink href={exportHref("csv")} label="CSV" />
            <DownloadLink href={exportHref("pdf")} label="PDF" />
          </span>
        }
      >
        {result || isRunning ? (
          <ResultsTable
            columns={result?.columns ?? []}
            rows={result?.rows ?? []}
            totalRows={result?.totalRows ?? 0}
            isLoading={isRunning}
          />
        ) : (
          <EmptyState
            icon={createElement(dataSourceIcon(report.dataSource), { className: "h-8 w-8" })}
            title="Not run yet"
            body="Check the dates above, then run the report. You can also download it without running it here."
            action={
              <Button size="sm" hierarchy="primary" onClick={() => void handleRun()} leadingIcon={<Play className="h-3.5 w-3.5" />}>
                Run report
              </Button>
            }
          />
        )}
      </Panel>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        {/* ── About ────────────────────────────────────────────────── */}
        <Panel
          title="About this report"
          action={
            <span className="flex items-center gap-1.5">
              <Button size="sm" hierarchy="secondary" onClick={() => setDialog("copy")} leadingIcon={<Copy className="h-3.5 w-3.5" />}>
                Make a copy
              </Button>
              {isOwner && !report.isTemplate && (
                <Button
                  size="sm"
                  hierarchy="tertiary"
                  tone="error"
                  onClick={() => setDialog("delete")}
                  leadingIcon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Delete
                </Button>
              )}
            </span>
          }
        >
          <dl className="m-0 flex flex-col">
            {details.map((d, i) => (
              <div
                key={d.label}
                className="grid gap-x-4 py-2.5 [grid-template-columns:140px_minmax(0,1fr)]"
                style={{ borderTop: i === 0 ? undefined : "1px solid var(--stroke-divider)" }}
              >
                <dt style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>{d.label}</dt>
                <dd className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-primary)", overflowWrap: "anywhere" }}>
                  {d.value}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        {/* ── Email schedule ───────────────────────────────────────── */}
        <Panel
          title="Email schedule"
          action={
            schedule ? (
              <Badge tone={schedule.isActive ? "success" : "neutral"} size="sm" dot>
                {schedule.isActive ? "On" : "Paused"}
              </Badge>
            ) : undefined
          }
        >
          {schedule ? (
            <div className="flex h-full flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                  {describeSchedule(schedule.cronExpr, schedule.timezone)}
                </span>
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  Sent as {FORMAT_NAME[schedule.format] ?? schedule.format} to {recipients.length}{" "}
                  {recipients.length === 1 ? "person" : "people"}
                  {schedule.isActive ? "" : ". Paused, so nothing is being sent."}
                </span>
              </div>
              {recipients.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {recipients.map((r) => (
                    <li
                      key={r}
                      className="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5"
                      style={{ background: "var(--surface-secondary)", font: "var(--type-caption1)", color: "var(--text-secondary)" }}
                    >
                      <Mail className="h-3 w-3" aria-hidden="true" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" hierarchy="secondary" onClick={() => setDialog("schedule")}>
                    Edit schedule
                  </Button>
                  <Button
                    size="sm"
                    hierarchy="tertiary"
                    disabled={isToggling}
                    leadingIcon={schedule.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    onClick={() =>
                      startToggle(async () => {
                        const res = await toggleSchedule({ id: schedule.id, isActive: !schedule.isActive });
                        if (!res.success) setError("The schedule could not be changed. You may not have permission.");
                        router.refresh();
                      })
                    }
                  >
                    {schedule.isActive ? "Pause emails" : "Turn emails back on"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-start gap-3">
              <p className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                {canEdit
                  ? "Not emailed to anyone. Set a schedule to send this report automatically, as Excel, CSV or PDF."
                  : "Not emailed to anyone. The owner can set up a schedule."}
              </p>
              {canEdit && (
                <Button size="sm" hierarchy="secondary" onClick={() => setDialog("schedule")} leadingIcon={<Mail className="h-3.5 w-3.5" />}>
                  Set up email
                </Button>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Run history ─────────────────────────────────────────────── */}
      <Panel title="Run history" subtitle="The last ten times it ran, by hand or by email." flush>
        {report.runs.length === 0 ? (
          <EmptyState title="Never run" body="Each time the report runs, here or by email, it is listed here with how many rows it found." />
        ) : (
          <ul className="m-0 list-none p-0">
            {report.runs.map((run) => {
              const r = RUN_RESULT[run.status] ?? { label: run.status, tone: "neutral" as const };
              return (
                <li
                  key={run.id}
                  className="grid items-center gap-x-4 px-5 py-2.5 [grid-template-columns:minmax(150px,1fr)_minmax(140px,1fr)_80px_minmax(90px,auto)]"
                  style={{ borderTop: "1px solid var(--stroke-divider)" }}
                >
                  <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }}>
                    {format(new Date(run.startedAt), "MMM d, yyyy · h:mm a")}
                  </span>
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    {HOW_RUN[run.triggeredBy] ?? run.triggeredBy}
                  </span>
                  <span className="tabular text-right" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                    {run.rowCount === null ? "" : `${run.rowCount.toLocaleString("en-US")} rows`}
                  </span>
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <Badge tone={r.tone} size="sm">
                      {r.label}
                    </Badge>
                    {run.error && (
                      <span className="truncate" title={run.error} style={{ font: "var(--type-caption1)", color: "var(--text-error)", maxWidth: 320 }}>
                        {run.error}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {dialog === "share" && (
        <ShareDialog
          reportId={report.id}
          reportName={report.name}
          visibility={report.visibility}
          shares={report.shares}
          tenantUsers={tenantUsers ?? []}
          onClose={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}

      {dialog === "schedule" && (
        <ScheduleForm
          reportId={report.id}
          coverage={
            cfg.dateRange
              ? {
                  text: describeRange(cfg.dateRange, filterOptions?.payPeriods ?? []),
                  moves: ["today", "yesterday", "relative", "calendar"].includes(cfg.dateRange.type),
                }
              : undefined
          }
          existingSchedule={
            schedule
              ? {
                  id: schedule.id,
                  cronExpr: schedule.cronExpr,
                  timezone: schedule.timezone,
                  format: schedule.format,
                  recipients,
                  isActive: schedule.isActive,
                }
              : undefined
          }
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}

      {dialog === "copy" && (
        <CopyDialog
          defaultName={`${report.name} copy`}
          onClose={() => setDialog(null)}
          onCopy={async (name) => {
            const res = await duplicateReport({ id: report.id, name });
            if (!res.success) return "The copy was not made. Try again.";
            router.push(`/reports/${res.data.id}`);
            return null;
          }}
        />
      )}

      {dialog === "delete" && (
        <DeleteDialog
          name={report.name}
          scheduled={!!schedule}
          onClose={() => setDialog(null)}
          onDelete={async () => {
            const res = await deleteReport({ id: report.id });
            if (!res.success) return "The report was not deleted. Only its owner can delete it.";
            router.push("/reports");
            return null;
          }}
        />
      )}
    </div>
  );
}

/** A card with a header row: title, one quiet line, and its actions. */
function Panel({
  title,
  subtitle,
  subtitleTone,
  action,
  flush = false,
  children,
}: {
  title: string;
  subtitle?: string;
  subtitleTone?: "warning";
  action?: ReactNode;
  /** The body runs edge to edge, for a table. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className="flex flex-col overflow-hidden"
      style={{ background: "var(--surface-card)", borderRadius: "var(--radius-l)", boxShadow: "var(--shadow-card)" }}
    >
      <header className="flex flex-wrap items-start gap-3 px-5 pb-3 pt-4">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>{title}</h2>
          {subtitle && (
            <span style={{ font: "var(--type-body2)", color: subtitleTone === "warning" ? "var(--text-warning)" : "var(--text-tertiary)" }}>
              {subtitle}
            </span>
          )}
        </span>
        {action}
      </header>
      <div className={flush ? "flex-1" : "flex-1 px-5 pb-5"} style={flush ? { borderTop: "1px solid var(--stroke-divider)" } : undefined}>
        {children}
      </div>
    </section>
  );
}

/**
 * A download. A plain link, since the file streams from an API route and
 * there is no page to move to; it borrows the secondary button's look.
 */
function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      title={`Download as ${label}`}
      className="wms-btn inline-flex h-7 flex-none items-center gap-1.5 whitespace-nowrap rounded-md px-2.5"
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
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </a>
  );
}

/** A small window over the page, closed by its X, Cancel, Escape or the scrim. */
function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="ta-modal flex w-full max-w-md flex-col" style={{ borderRadius: "var(--radius-l)" }}>
        <header className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
          <h2 className="min-w-0 flex-1" style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
            {title}
          </h2>
          <Button hierarchy="tertiary" iconOnly onClick={onClose} aria-label="Close" title="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
        <footer className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
          {footer}
        </footer>
      </div>
    </div>
  );
}

function CopyDialog({
  defaultName,
  onClose,
  onCopy,
}: {
  defaultName: string;
  onClose: () => void;
  onCopy: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(defaultName);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      setErr(await onCopy(name.trim()));
    });
  return (
    <Dialog
      title="Make a copy"
      onClose={onClose}
      footer={
        <>
          <Button hierarchy="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button hierarchy="primary" onClick={go} disabled={pending || !name.trim()} leadingIcon={<Copy className="h-4 w-4" />}>
            {pending ? "Copying" : "Make a copy"}
          </Button>
        </>
      }
    >
      <p className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
        The copy is yours and private. Change it without affecting this one.
      </p>
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {err && (
        <p role="alert" className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>
          {err}
        </p>
      )}
    </Dialog>
  );
}

function DeleteDialog({
  name,
  scheduled,
  onClose,
  onDelete,
}: {
  name: string;
  scheduled: boolean;
  onClose: () => void;
  onDelete: () => Promise<string | null>;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog
      title="Delete this report?"
      onClose={onClose}
      footer={
        <>
          <Button hierarchy="secondary" onClick={onClose} disabled={pending}>
            Keep it
          </Button>
          <Button
            hierarchy="primary"
            tone="error"
            disabled={pending}
            leadingIcon={<Trash2 className="h-4 w-4" />}
            onClick={() => start(async () => setErr(await onDelete()))}
          >
            {pending ? "Deleting" : "Delete report"}
          </Button>
        </>
      }
    >
      <p className="m-0" style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}>
        {name} will be removed for you and everyone it is shared with
        {scheduled ? ", and its emails will stop" : ""}. This cannot be undone.
      </p>
      <p className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
        The hours and punches it reads are not touched.
      </p>
      {err && (
        <p role="alert" className="m-0" style={{ font: "var(--type-body2)", color: "var(--text-error)" }}>
          {err}
        </p>
      )}
    </Dialog>
  );
}
