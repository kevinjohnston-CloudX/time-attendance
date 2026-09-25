"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight, FileText } from "lucide-react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Button, EmptyState, FilterSelectChip, SearchInput } from "@/components/ui";
import { STANDARD_REPORTS, dataSourceDescription, dataSourceIcon, dataSourceLabel } from "./data-source-label";
import { FolderTree, type FolderNode } from "./report-list/folder-tree";

/**
 * The Reports page below its header: the standard reports anyone can start
 * from, then the reports people have saved.
 *
 * <p>The standard reports come first because they are how most people will
 * use this page. Each is one of the six data sources the builder reads,
 * named for what it answers and opened with that source already picked, so
 * nobody has to know what a data source is to get their hours out.
 *
 * <p>What saved reports you can see is still decided entirely by
 * `getMyReports`: your own, the ones shared with you and the ones published
 * to everyone. The search, type, year and folder only narrow those rows, and
 * all four live in the link, so a narrowed list can be sent to somebody.
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
}

/** Where a row came from: the three lists `getMyReports` returns. */
const ACCESS_LABEL = {
  owned: "Yours",
  shared: "Shared with you",
  tenantWide: "Everyone",
} as const;

type Access = keyof typeof ACCESS_LABEL;

const COLUMNS = "minmax(200px, 2fr) minmax(130px, 1fr) minmax(90px, 0.8fr) minmax(96px, 0.8fr) 44px 96px 16px";

export function ReportsList({
  reports,
  folders,
  q,
  type,
  year,
  folder,
}: {
  reports: { owned: ReportRow[]; shared: ReportRow[]; tenantWide: ReportRow[] };
  folders: { id: string; name: string; parentId: string | null; reportCount: number; children: { id: string; name: string }[] }[];
  q: string;
  type: string;
  year: string;
  folder: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q);

  const listHref = (over: Partial<Record<"q" | "type" | "year" | "folder", string>>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: query.trim(), type, year, folder, ...over })) if (v) sp.set(k, v);
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

  // Derived from the rows rather than fixed, so neither pill can offer a
  // value that returns nothing.
  const typeOptions = [...new Set(rows.map((r) => r.report.dataSource))]
    .map((id) => ({ id, name: dataSourceLabel(id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const yearOptions = [...new Set(rows.map((r) => new Date(r.report.updatedAt).getFullYear()))]
    .sort((a, b) => b - a)
    .map((y) => ({ id: String(y), name: String(y) }));

  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(({ report }) => {
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

  const narrowed = Boolean(needle || type || year || folder);
  // The rail is worth its width only when there is something in it, or a
  // report of your own that could go in it.
  const showRail = folders.length > 0 || reports.owned.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Standard reports ─────────────────────────────────────────── */}
      <section
        className="flex flex-col"
        style={{ background: "var(--surface-card)", borderRadius: "var(--radius-l)", boxShadow: "var(--shadow-card)" }}
        aria-labelledby="standard-reports"
      >
        <header className="flex flex-col gap-0.5 px-5 pb-3 pt-4">
          <h2 id="standard-reports" style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
            Standard reports
          </h2>
          <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
            Pick one, choose the dates, and see the results. You can save it to run again later.
          </p>
        </header>
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {STANDARD_REPORTS.map((id) => {
            const Icon = dataSourceIcon(id);
            return (
              <Link
                key={id}
                href={`/reports/new?source=${id}`}
                className="ta-hoverable group flex items-start gap-3 rounded-xl p-4"
                style={{ border: "1px solid var(--stroke-secondary)", textDecoration: "none" }}
              >
                <span
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-lg"
                  style={{ background: "var(--surface-info)", color: "var(--icon-accent)" }}
                  aria-hidden="true"
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                    {dataSourceLabel(id)}
                  </span>
                  <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>{dataSourceDescription(id)}</span>
                </span>
                <ChevronRight
                  className="mt-2.5 h-4 w-4 flex-none transition-transform group-hover:translate-x-0.5"
                  style={{ color: "var(--icon-tertiary)" }}
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Saved reports ────────────────────────────────────────────── */}
      <div className="flex flex-col items-start gap-4 lg:flex-row">
        {showRail && (
          <div className="w-full flex-none lg:w-[228px]">
            <FolderTree
              folders={folderNodes}
              selectedFolderId={folder || null}
              allHref={listHref({ folder: "" })}
              totalReports={rows.length}
            />
          </div>
        )}

        <section
          className="flex w-full min-w-0 flex-1 flex-col overflow-hidden"
          style={{ background: "var(--surface-card)", borderRadius: "var(--radius-l)", boxShadow: "var(--shadow-card)" }}
          aria-labelledby="saved-reports"
        >
          <header className="flex flex-wrap items-baseline gap-x-2 px-5 pb-3 pt-4">
            <h2 id="saved-reports" style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
              Saved reports
            </h2>
            <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {narrowed ? `${filtered.length} of ${rows.length}` : rows.length}
            </span>
          </header>

          {rows.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 px-5 pb-3"
              style={{ borderBottom: "1px solid var(--stroke-divider)" }}
            >
              <SearchInput value={query} onValueChange={setQuery} placeholder="Report name or owner" width={260} />
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
              {narrowed && (
                <Button
                  hierarchy="link"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    router.replace("/reports", { scroll: false });
                  }}
                >
                  Clear all
                </Button>
              )}
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="No saved reports yet"
              body="Open a standard report above, set it up the way you need, and save it. It will be here to run again, share or email on a schedule."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="No saved reports match"
              body="Nothing matches that search, type, year or folder."
              action={
                <Button
                  size="sm"
                  hierarchy="secondary"
                  onClick={() => {
                    setQuery("");
                    router.replace("/reports", { scroll: false });
                  }}
                >
                  Clear all
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div
                  className="grid items-center gap-x-3 px-5 py-2.5"
                  style={{ gridTemplateColumns: COLUMNS, borderBottom: "1px solid var(--stroke-divider)" }}
                  role="presentation"
                >
                  <span className="wms-overline">Report</span>
                  <span className="wms-overline">Type</span>
                  <span className="wms-overline">Owner</span>
                  <span className="wms-overline">Access</span>
                  <span className="wms-overline text-right">Runs</span>
                  <span className="wms-overline whitespace-nowrap">Updated</span>
                  <span />
                </div>
                <ul className="m-0 list-none p-0">
                  {filtered.map(({ report, access }) => {
                    const Icon = dataSourceIcon(report.dataSource);
                    return (
                      // A report can be both shared with you and published to
                      // everyone, so it can be listed twice. The id alone is
                      // not unique down this list.
                        <li key={`${access}-${report.id}`}>
                          <Link
                            href={`/reports/${report.id}`}
                            className="ta-hoverable grid min-h-[56px] items-center gap-x-3 px-5 py-2.5"
                            style={{
                              gridTemplateColumns: COLUMNS,
                              borderBottom: "1px solid var(--stroke-divider)",
                              textDecoration: "none",
                            }}
                          >
                            <span className="flex min-w-0 flex-col">
                              <span
                                className="truncate"
                                title={report.name}
                                style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}
                              >
                                {report.name}
                              </span>
                              {report.description && (
                                <span
                                  className="truncate"
                                  title={report.description}
                                  style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}
                                >
                                  {report.description}
                                </span>
                              )}
                            </span>
                            <span
                              className="flex min-w-0 items-center gap-2"
                              style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                            >
                              <Icon className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
                              <span className="truncate">{dataSourceLabel(report.dataSource)}</span>
                            </span>
                            <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                              {access === "owned" ? "You" : report.ownerName ?? "Unknown"}
                            </span>
                            <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                              {ACCESS_LABEL[access]}
                            </span>
                            <span className="tabular text-right" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                              {report.runs}
                            </span>
                            <span className="tabular whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                              {format(new Date(report.updatedAt), "MMM d, yyyy")}
                            </span>
                            <ChevronRight className="h-4 w-4" style={{ color: "var(--icon-tertiary)" }} aria-hidden="true" />
                          </Link>
                        </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
