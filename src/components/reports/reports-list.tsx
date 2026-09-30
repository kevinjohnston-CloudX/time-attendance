"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight, FileText, Mail, Plus } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { useCondensingBar } from "@/components/layout/use-condensing-bar";
import {
  Banner,
  Button,
  EmptyState,
  FilterSelectChip,
  PageHeader,
  PinnedBar,
  SearchInput,
  SegmentedLinks,
  ToolsBar,
  ToolsCount,
} from "@/components/ui";
import { STANDARD_REPORTS, dataSourceDescription, dataSourceLabel } from "./data-source-label";
import { FolderTree, type FolderNode } from "./report-list/folder-tree";
import { ReportTypeIcon } from "./report-type-icon";
import { ReportTypeDialog, type ReportTypeOption } from "./report-type-dialog";

/**
 * The Reports page: the reports people have saved, and nothing else.
 *
 * <p>Starting a report is New report's job, a window of the six report
 * types that opens the builder on the one picked (`?new=1` opens it too, which
 * is where a bare /reports/new lands). The page only offers those types itself
 * while there is
 * nothing saved yet, as its empty state, so an empty page still says where to
 * begin without the same six choices sitting above every full one.
 *
 * <p>What you can see is decided entirely by `getMyReports`: your own, the
 * ones shared with you and the ones published to everyone. The view tabs,
 * search, type, year and folder only narrow those rows, and all of them live
 * in the link, so a narrowed list survives a reload and can be sent on.
 */

/** Everything this list needs from a saved report. */
export interface ReportRow {
  id: string;
  name: string;
  description: string | null;
  dataSource: string;
  updatedAt: string;
  folderId: string | null;
  ownerName: string | null;
  runs: number;
  /** When it last ran, by hand or on a schedule. */
  lastRunAt: string | null;
  /** The next email of an active schedule, when it has one. */
  nextEmailAt: string | null;
  scheduled: boolean;
}

/** Where a row came from: the three lists `getMyReports` returns. */
const ACCESS_LABEL = {
  owned: "Yours",
  shared: "Shared with you",
  tenantWide: "Everyone",
} as const;

type Access = keyof typeof ACCESS_LABEL;

/** The view tabs, and which of the three lists each one keeps. */
const VIEWS = [
  { value: "", label: "All", keep: null },
  { value: "mine", label: "Mine", keep: "owned" },
  { value: "shared", label: "Shared with me", keep: "shared" },
  { value: "everyone", label: "Everyone", keep: "tenantWide" },
] as const;

type Params = "q" | "view" | "type" | "year" | "folder";

/**
 * One grid for the header and every row. A narrow window keeps the report,
 * its type and when it last ran, and lets owner, access and updated go, the
 * way the Employees list does, rather than scrolling sideways: a sideways
 * scroller would stop the column header pinning under the page bar.
 */
const GRID = {
  ["--cols" as string]:
    "minmax(260px, 3.2fr) minmax(130px, 1fr) minmax(90px, 0.8fr) minmax(90px, 0.8fr) minmax(104px, 0.8fr) minmax(96px, 0.7fr) 16px",
  ["--cols-narrow" as string]: "minmax(0, 2fr) minmax(110px, 1fr) minmax(96px, 0.8fr) 16px",
};
const GRID_CLS = "grid [grid-template-columns:var(--cols)] max-[1180px]:[grid-template-columns:var(--cols-narrow)]";
const WIDE = "max-[1180px]:hidden";

export function ReportsList({
  reports,
  folders,
  sources,
  openNew = false,
  loadFailed,
  q,
  view,
  type,
  year,
  folder,
}: {
  reports: { owned: ReportRow[]; shared: ReportRow[]; tenantWide: ReportRow[] };
  folders: { id: string; name: string; parentId: string | null; reportCount: number; children: { id: string; name: string }[] }[];
  /** The report types New report offers. Empty when they did not load. */
  sources: ReportTypeOption[];
  /** Open on the New report window. */
  openNew?: boolean;
  loadFailed: boolean;
  q: string;
  view: string;
  type: string;
  year: string;
  folder: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [picking, setPicking] = useState(openNew && sources.length > 0);
  const { barRef, markerRef, condensed, barHeight } = useCondensingBar();
  const activeView = VIEWS.find((v) => v.value === view) ?? VIEWS[0];

  const listHref = (over: Partial<Record<Params, string>>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: query.trim(), view: activeView.value, type, year, folder, ...over })) {
      if (v) sp.set(k, v);
    }
    const qs = sp.toString();
    return qs ? `/reports?${qs}` : "/reports";
  };

  // The search narrows as you type; the link follows a moment later, so a
  // reload or a copied link keeps it without a page load on every key.
  useEffect(() => {
    if (query.trim() === q.trim()) return;
    const t = setTimeout(() => router.replace(listHref({}), { scroll: false }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const rows = [
    ...reports.owned.map((r) => ({ report: r, access: "owned" as Access })),
    ...reports.shared.map((r) => ({ report: r, access: "shared" as Access })),
    ...reports.tenantWide.map((r) => ({ report: r, access: "tenantWide" as Access })),
  ];
  const inView = activeView.keep ? rows.filter((r) => r.access === activeView.keep) : rows;

  // Derived from the rows rather than fixed, so neither pill can offer a
  // value that returns nothing.
  const typeOptions = [...new Set(rows.map((r) => r.report.dataSource))]
    .map((id) => ({ id, name: dataSourceLabel(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const yearOptions = [...new Set(rows.map((r) => new Date(r.report.updatedAt).getFullYear()))]
    .sort((a, b) => b - a)
    .map((y) => ({ id: String(y), name: String(y) }));

  const needle = query.trim().toLowerCase();
  const filtered = inView.filter(({ report }) => {
    // The owner is searchable because it is on the row: "Dana" has to find
    // the reports that say they are Dana's.
    const hay = `${report.name} ${report.description ?? ""} ${report.ownerName ?? ""}`.toLowerCase();
    if (needle && !hay.includes(needle)) return false;
    if (type && report.dataSource !== type) return false;
    if (year && String(new Date(report.updatedAt).getFullYear()) !== year) return false;
    if (folder && report.folderId !== folder) return false;
    return true;
  });

  const folderNodes: FolderNode[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    href: listHref({ folder: f.id }),
    reportCount: f.reportCount,
    children: f.children,
  }));

  const narrowed = Boolean(needle || activeView.value || type || year || folder);
  const clearAll = () => {
    setQuery("");
    router.replace("/reports", { scroll: false });
  };
  // The rail is worth its width only when there is something in it, or a
  // report of your own that could go in it.
  const showRail = folders.length > 0 || reports.owned.length > 0;

  // One line under the title that says what is here, the way Leave requests
  // opens: counts that exist, never a zero for its own sake.
  const scheduledCount = new Set(rows.filter((r) => r.report.scheduled).map((r) => r.report.id)).size;
  const status =
    rows.length === 0
      ? "Nothing saved yet"
      : [
          `${reports.owned.length.toLocaleString()} saved by you`,
          reports.shared.length ? `${reports.shared.length.toLocaleString()} shared with you` : null,
          reports.tenantWide.length ? `${reports.tenantWide.length.toLocaleString()} shared with everyone` : null,
          scheduledCount ? `${scheduledCount.toLocaleString()} emailed on a schedule` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="relative flex flex-col gap-4">
      <span ref={markerRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px" />
      <PinnedBar barRef={barRef}>
        <PageHeader
          title="Reports"
          subtitle={status}
          condensed={condensed}
          actions={
            <>
              {/* The views sit in the title row, as on Live Attendance, so the
                  bar below gets its own full line. */}
              {rows.length > 0 && (
                <SegmentedLinks
                  ariaLabel="Whose reports"
                  active={activeView.value}
                  items={VIEWS.map((v) => ({
                    value: v.value,
                    label: v.label,
                    href: listHref({ view: v.value }),
                    count: v.keep ? rows.filter((r) => r.access === v.keep).length : rows.length,
                  }))}
                />
              )}
              <Button
                hierarchy="primary"
                leadingIcon={<Plus className="h-4 w-4" />}
                disabled={sources.length === 0}
                title={sources.length === 0 ? "The report types did not load. Reload the page to try again." : undefined}
                onClick={() => setPicking(true)}
              >
                New report
              </Button>
            </>
          }
        />
        {rows.length > 0 && (
          <div>
            <ToolsBar
              search={<SearchInput value={query} onValueChange={setQuery} placeholder="Report name or owner" width={300} />}
              end={
                <>
                  {narrowed && (
                    <Button hierarchy="link" size="sm" onClick={clearAll}>
                      Clear all
                    </Button>
                  )}
                  <ToolsCount>
                    {narrowed
                      ? `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} reports`
                      : `${rows.length.toLocaleString()} ${rows.length === 1 ? "report" : "reports"}`}
                  </ToolsCount>
                </>
              }
            >
              {typeOptions.length > 1 && (
                <FilterSelectChip
                  label="Type"
                  allLabel="Every type"
                  value={type}
                  options={typeOptions}
                  onChange={(v) => router.replace(listHref({ type: v }), { scroll: false })}
                />
              )}
              {yearOptions.length > 1 && (
                <FilterSelectChip
                  label="Updated"
                  allLabel="Any year"
                  value={year}
                  options={yearOptions}
                  onChange={(v) => router.replace(listHref({ year: v }), { scroll: false })}
                />
              )}
            </ToolsBar>
          </div>
        )}
      </PinnedBar>

      {loadFailed && (
        <Banner
          tone="error"
          title="Saved reports could not be loaded"
          body="New report still works. Reload the page to try the saved ones again."
        />
      )}

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        {showRail && rows.length > 0 && (
          // Pinned exactly where it already sits: the bar's 12px of bottom
          // padding comes back as a -12px margin, then the 16px gap, so 4px
          // under the bar. Any more and it slid down by the difference
          // whenever the list beside it was tall enough to let it.
          <div className="w-full flex-none lg:sticky lg:w-[228px]" style={{ top: barHeight + 4 }}>
            <FolderTree
              folders={folderNodes}
              selectedFolderId={folder || null}
              allHref={listHref({ folder: "" })}
              totalReports={inView.length}
            />
          </div>
        )}

        <section
          className="flex w-full min-w-0 flex-1 flex-col"
          style={{
            background: "var(--surface-card)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-card)",
            overflow: "clip",
          }}
          aria-label="Saved reports"
        >
          {rows.length === 0 ? (
            loadFailed ? null : <FirstReport />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="No reports match"
              body="Nothing matches that view, search, type, year or folder."
              action={
                <Button size="sm" hierarchy="secondary" onClick={clearAll}>
                  Clear all
                </Button>
              }
            />
          ) : (
            <div>
              <div>
                <div
                  className={`sticky z-10 h-10 items-center gap-x-4 px-5 ${GRID_CLS}`}
                  style={{
                    ...GRID,
                    top: barHeight,
                    background: "var(--surface-secondary)",
                    borderBottom: "1px solid var(--stroke-divider)",
                  }}
                  role="presentation"
                >
                  <span className="wms-overline">Report</span>
                  <span className="wms-overline">Type</span>
                  <span className={`wms-overline ${WIDE}`}>Owner</span>
                  <span className={`wms-overline ${WIDE}`}>Access</span>
                  <span className="wms-overline whitespace-nowrap">Last run</span>
                  <span className={`wms-overline whitespace-nowrap ${WIDE}`}>Updated</span>
                  <span />
                </div>
                <ul className="m-0 list-none p-0">
                  {filtered.map(({ report, access }) => (
                    // A report can be both shared with you and published to
                    // everyone, so it can be listed twice. The id alone is not
                    // unique down this list.
                    <li key={`${access}-${report.id}`} style={{ borderBottom: "1px solid var(--stroke-divider)" }}>
                      <ReportLine report={report} access={access} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>

      {picking && (
        <ReportTypeDialog
          sources={sources}
          onPick={(id) => router.push(`/reports/new?source=${id}`)}
          onClose={() => {
            setPicking(false);
            if (openNew) router.replace(listHref({}), { scroll: false });
          }}
        />
      )}
    </div>
  );
}

function ReportLine({ report, access }: { report: ReportRow; access: Access }) {
  const cell = { font: "var(--type-body2)", color: "var(--text-secondary)" } as const;
  return (
    <Link
      href={`/reports/${report.id}`}
      className={`ta-hoverable group min-h-[64px] items-center gap-x-4 px-5 py-3 ${GRID_CLS}`}
      style={{ ...GRID, textDecoration: "none" }}
    >
      <span className="flex min-w-0 items-center gap-3">
        <ReportTypeIcon id={report.dataSource} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="truncate"
              title={report.name}
              style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}
            >
              {report.name}
            </span>
            {report.scheduled && (
              <span
                className="inline-flex h-5 flex-none items-center gap-1 whitespace-nowrap rounded-full px-2"
                style={{ background: "var(--surface-info)", color: "var(--text-accent)", font: "var(--type-caption1)", fontWeight: "var(--weight-medium)" }}
                title={report.nextEmailAt ? `Next email ${format(new Date(report.nextEmailAt), "EEE, MMM d")}` : "Emailed on a schedule"}
              >
                <Mail className="h-3 w-3" aria-hidden="true" />
                Scheduled
              </span>
            )}
          </span>
          {report.description && (
            <span className="truncate" title={report.description} style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {report.description}
            </span>
          )}
        </span>
      </span>
      <span className="truncate" style={cell}>
        {dataSourceLabel(report.dataSource)}
      </span>
      <span className={`truncate ${WIDE}`} style={cell}>
        {access === "owned" ? "You" : report.ownerName ?? "Unknown"}
      </span>
      <span className={`truncate ${WIDE}`} style={cell}>
        {ACCESS_LABEL[access]}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="tabular whitespace-nowrap" style={{ ...cell, color: report.lastRunAt ? "var(--text-primary)" : "var(--text-tertiary)" }}>
          {report.lastRunAt ? format(new Date(report.lastRunAt), "MMM d, yyyy") : "Never run"}
        </span>
        {report.runs > 0 && (
          <span className="tabular" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            {report.runs.toLocaleString()} {report.runs === 1 ? "run" : "runs"}
          </span>
        )}
      </span>
      <span className={`tabular whitespace-nowrap ${WIDE}`} style={cell}>
        {format(new Date(report.updatedAt), "MMM d, yyyy")}
      </span>
      <ChevronRight
        className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
        style={{ color: "var(--icon-tertiary)" }}
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * The page with nothing saved: the one place it offers the report types
 * itself, so a first visit is one click from a report.
 */
function FirstReport() {
  return (
    <div className="flex flex-col gap-6 px-6 pb-6 pt-10">
      <div className="mx-auto flex max-w-[520px] flex-col items-center gap-2 text-center">
        <span
          className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: "var(--surface-tertiary)", color: "var(--icon-secondary)" }}
          aria-hidden="true"
        >
          <FileText className="h-6 w-6" />
        </span>
        <h2 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>No saved reports yet</h2>
        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          Start from one of these. Pick the dates, check the results, then save it to run again, share it, or have it
          emailed on a schedule.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {STANDARD_REPORTS.map((id) => (
          <Link
            key={id}
            href={`/reports/new?source=${id}`}
            className="ta-hoverable group flex items-start gap-3 rounded-xl p-4"
            style={{ border: "1px solid var(--stroke-secondary)", textDecoration: "none" }}
          >
            <ReportTypeIcon id={id} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                {dataSourceLabel(id)}
              </span>
              <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                {dataSourceDescription(id)}
              </span>
            </span>
            <ChevronRight
              className="mt-2.5 h-4 w-4 flex-none transition-transform group-hover:translate-x-0.5"
              style={{ color: "var(--icon-tertiary)" }}
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
