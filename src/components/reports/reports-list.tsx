import { format } from "date-fns";
import { FileText } from "lucide-react";
import {
  Card,
  EmptyState,
  FilterBar,
  FilterChip,
  LinkButton,
  Table,
  TableFooter,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Toolbar,
} from "@/components/ui";
import { dataSourceIcon, dataSourceLabel } from "./data-source-label";
import { FolderTree, type FolderNode } from "./report-list/folder-tree";
import { ReportsFilters } from "./report-list/reports-filters";

/**
 * The saved reports list, as the portal design's list screen.
 *
 * <p>Three sources in one table — the reports you own, the ones shared with
 * you and the ones the tenant publishes — because they are the same kind of
 * record and the old three-grids-of-cards layout made the same report look
 * like three different things depending on which heading it fell under. Which
 * of the three a row came from is a column, so nothing is lost.
 *
 * <p>The design's Schedule, Last Run and Recipients columns are not here. The
 * list query loads each report with its folder, its owner and a count of its
 * runs, and nothing else; schedules and run times are loaded one report at a
 * time by the viewer. Adding them would mean changing what this screen asks
 * the database for, which is not a presentation change.
 */

/** Everything this list needs from a report row. Prisma's own rows satisfy it. */
export interface ReportRow {
  id: string;
  name: string;
  description?: string | null;
  dataSource: string;
  updatedAt: Date | string;
  folderId?: string | null;
  owner?: { name: string | null } | null;
  _count?: { runs: number };
}

/** Where a row came from — the three lists `getMyReports` returns. */
const ACCESS_LABEL = {
  owned: "Mine",
  shared: "Shared with me",
  tenantWide: "Organization",
} as const;

type Access = keyof typeof ACCESS_LABEL;

export function ReportsList({
  reports,
  folders,
  q,
  type,
  year,
  folder,
}: {
  reports: { owned: ReportRow[]; shared: ReportRow[]; tenantWide: ReportRow[] };
  folders: { id: string; name: string; parentId: string | null; _count: { reports: number }; children: { id: string; name: string }[] }[];
  q: string;
  type: string;
  year: string;
  folder: string;
}) {
  const rows = [
    ...reports.owned.map((r) => ({ report: r, access: "owned" as Access })),
    ...reports.shared.map((r) => ({ report: r, access: "shared" as Access })),
    ...reports.tenantWide.map((r) => ({ report: r, access: "tenantWide" as Access })),
  ];

  // Derived rather than hard-coded, so neither dropdown can offer a value that
  // returns nothing.
  const typeOptions = [...new Set(rows.map((r) => r.report.dataSource))]
    .map((value) => ({ value, label: dataSourceLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const yearOptions = [...new Set(rows.map((r) => new Date(r.report.updatedAt).getFullYear()))].sort(
    (a, b) => b - a
  );

  const needle = q.trim().toLowerCase();
  const filtered = rows.filter(({ report }) => {
    // Owner is part of the haystack because it is a column: "Dana" has to find
    // the reports the Owner column says are Dana's.
    const hay = `${report.name} ${report.description ?? ""} ${report.owner?.name ?? ""}`.toLowerCase();
    if (needle && !hay.includes(needle)) return false;
    if (type && report.dataSource !== type) return false;
    if (year && String(new Date(report.updatedAt).getFullYear()) !== year) return false;
    if (folder && report.folderId !== folder) return false;
    return true;
  });

  const listHref = (over: Partial<Record<"q" | "type" | "year" | "folder", string>>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, type, year, folder, ...over })) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `/reports?${qs}` : "/reports";
  };

  const folderNodes: FolderNode[] = folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    href: listHref({ folder: f.id }),
    reportCount: f._count.reports,
    children: f.children,
  }));

  const filtersApplied = Boolean(needle || type || year || folder);
  const folderName = folders.find((f) => f.id === folder)?.name ?? folder;

  // The rail is worth its width only when there is something in it, or
  // something of your own that could go in it.
  const showRail = folders.length > 0 || reports.owned.length > 0;

  return (
    <div className="flex flex-wrap items-start gap-4">
      {showRail && (
        <div className="w-full flex-none sm:w-[212px]">
          <FolderTree
            folders={folderNodes}
            selectedFolderId={folder || null}
            allHref={listHref({ folder: "" })}
            totalReports={rows.length}
          />
        </div>
      )}

      <div className="flex min-w-[320px] flex-1 flex-col gap-2.5">
        <Toolbar count={filtered.length} countLabel="report">
          <ReportsFilters
            q={q}
            type={type}
            year={year}
            folder={folder}
            typeOptions={typeOptions}
            yearOptions={yearOptions}
          />
        </Toolbar>

        {/* Folder gets a chip as well as the rail. "Clear all" drops it either
            way, and a chip row that silently leaves one filter out makes that
            link look like it cleared more than it did. */}
        <FilterBar clearHref={filtersApplied ? "/reports" : undefined}>
          {type ? (
            <FilterChip
              key="type"
              label="Type"
              value={dataSourceLabel(type)}
              clearHref={listHref({ type: "" })}
            />
          ) : null}
          {year ? (
            <FilterChip key="year" label="Year" value={year} clearHref={listHref({ year: "" })} />
          ) : null}
          {folder ? (
            <FilterChip
              key="folder"
              label="Folder"
              value={folderName}
              clearHref={listHref({ folder: "" })}
            />
          ) : null}
        </FilterBar>

        <Card padding={0}>
          {filtered.length === 0 ? (
            // Which of the two emptinesses this is decides whether somebody
            // goes looking for a report that exists or builds a second copy of
            // one they already have.
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title={filtersApplied ? "No reports match these filters" : "No reports yet"}
              body={
                filtersApplied
                  ? "Nothing here is filed under that search, type, year or folder. Widen the filters to see the rest."
                  : "Build one from a data source — hours, punches, exceptions or leave — and it can be run on demand or emailed on a schedule."
              }
              action={
                filtersApplied ? (
                  <LinkButton href="/reports" size="sm">
                    Clear filters
                  </LinkButton>
                ) : (
                  <LinkButton href="/reports/new" hierarchy="primary" size="sm">
                    New Report
                  </LinkButton>
                )
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Report</TH>
                    <TH>Type</TH>
                    <TH>Access</TH>
                    <TH>Owner</TH>
                    <TH numeric>Runs</TH>
                    <TH>Updated</TH>
                    <TH align="right">
                      <span className="sr-only">Open</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map(({ report, access }) => {
                    const Icon = dataSourceIcon(report.dataSource);
                    return (
                      // A report can be both shared with you and published to
                      // the tenant, so it can appear under two access labels.
                      // The id alone is not unique down this table.
                      <TR key={`${access}-${report.id}`}>
                        <TD>
                          <div className="flex min-w-0 flex-col">
                            <span style={{ fontWeight: "var(--weight-medium)" }}>{report.name}</span>
                            {report.description && (
                              <span
                                className="truncate"
                                style={{
                                  font: "var(--type-body2)",
                                  color: "var(--text-tertiary)",
                                  maxWidth: 360,
                                }}
                              >
                                {report.description}
                              </span>
                            )}
                          </div>
                        </TD>
                        <TD style={{ color: "var(--text-secondary)" }}>
                          <span className="inline-flex items-center gap-2">
                            <Icon
                              className="h-4 w-4 flex-none"
                              style={{ color: "var(--icon-tertiary)" }}
                              aria-hidden="true"
                            />
                            {dataSourceLabel(report.dataSource)}
                          </span>
                        </TD>
                        <TD style={{ color: "var(--text-secondary)" }}>{ACCESS_LABEL[access]}</TD>
                        <TD style={{ color: "var(--text-secondary)" }}>
                          {report.owner?.name ?? "—"}
                        </TD>
                        <TD numeric style={{ color: "var(--text-secondary)" }}>
                          {report._count?.runs ?? 0}
                        </TD>
                        {/* Tabular figures: this column is read down, to find
                            the one that was touched last. */}
                        <TD numeric align="left" style={{ color: "var(--text-secondary)" }}>
                          {format(new Date(report.updatedAt), "MMM d, yyyy")}
                        </TD>
                        <TD align="right">
                          <LinkButton href={`/reports/${report.id}`} size="sm">
                            Open
                          </LinkButton>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>

              <TableFooter
                shown={filtered.length}
                total={rows.length}
                label={rows.length === 1 ? "report" : "reports"}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
