import type { ReactNode } from "react";
import { format } from "date-fns";
import { Download, FileText } from "lucide-react";
import { DeleteDocumentButton } from "./delete-document-button";
import { DocumentsFilters } from "./documents-filters";
import { mimeToExt, mimeToLabel } from "@/lib/validators/document.schema";
import {
  Badge,
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
  PinnedBar,
} from "@/components/ui";

/**
 * The documents list, as the portal design's list screen.
 *
 * <p>One component for both audiences. HR sees every employee's file and an
 * extra column saying who put it there; an employee sees their own. The
 * difference is two columns and a delete control, not two screens, and the
 * previous split had already drifted — only the HR table could be searched,
 * and only the employee one showed a record count.
 *
 * <p>The design's Pay Period and Size columns are not here: a Document row
 * carries a title, a MIME type, when it was uploaded and by whom, and nothing
 * that says which pay period a statement covers or how large the file is.
 */

/** Wide enough for every caller: Prisma's own rows satisfy it as they are. */
export interface DocumentRow {
  id: string;
  title: string;
  fileType: string;
  uploadedAt: Date;
  uploadedBy: string;
  employee?: { user: { name: string | null } } | null;
}

/** The design's table footer pages at 25, and so does this. */
const PAGE_SIZE = 25;

export function DocumentsList({
  docs,
  basePath = "/documents",
  q,
  type,
  year,
  page,
  showEmployee = false,
  canDelete = false,
  searchPlaceholder,
  emptyTitle,
  emptyBody,
  header,
}: {
  docs: DocumentRow[];
  basePath?: string;
  q: string;
  type: string;
  year: string;
  page: number;
  showEmployee?: boolean;
  canDelete?: boolean;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyBody: string;
  /** The page title, pinned together with the filters under it. */
  header?: ReactNode;
}) {
  const typeOptions = buildTypeOptions(docs);
  const yearOptions = [...new Set(docs.map((d) => d.uploadedAt.getFullYear()))].sort((a, b) => b - a);

  const needle = q.trim().toLowerCase();
  const filtered = docs.filter((d) => {
    // The employee's name is searched wherever it is shown, which is how HR
    // has always searched this list: "Okafor" and "Pay Statement" both have to
    // land. Each field is matched on its own rather than against the two
    // joined together — a needle straddling the join ("Stub Maria") would
    // otherwise return a row no one asked for, on a screen where the row you
    // get back is somebody's pay statement.
    if (needle) {
      const title = d.title.toLowerCase();
      const name = showEmployee ? (d.employee?.user.name ?? "").toLowerCase() : "";
      if (!title.includes(needle) && !name.includes(needle)) return false;
    }
    if (type && d.fileType !== type) return false;
    if (year && String(d.uploadedAt.getFullYear()) !== year) return false;
    return true;
  });

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * PAGE_SIZE;
  const shown = filtered.slice(start, start + PAGE_SIZE);

  const filterHref = (over: Partial<Record<"q" | "type" | "year" | "page", string>>) => {
    const sp = new URLSearchParams();
    const next = { q, type, year, page: "", ...over };
    for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const typeLabel = typeOptions.find((o) => o.value === type)?.label ?? type;
  const filtersApplied = Boolean(needle || type || year);

  return (
    <div className="flex flex-col gap-4">
      <PinnedBar>
        {header}
        <div className="flex flex-col gap-2.5">
          <Toolbar count={filtered.length} countLabel="document">
            <DocumentsFilters
              q={q}
              type={type}
              year={year}
              typeOptions={typeOptions}
              yearOptions={yearOptions}
              placeholder={searchPlaceholder}
            />
          </Toolbar>

          <FilterBar clearHref={filtersApplied ? basePath : undefined}>
            {type ? (
              <FilterChip key="type" label="Type" value={typeLabel} clearHref={filterHref({ type: "" })} />
            ) : null}
            {year ? (
              <FilterChip key="year" label="Year" value={year} clearHref={filterHref({ year: "" })} />
            ) : null}
          </FilterBar>
        </div>
      </PinnedBar>

      <Card padding={0}>
        {filtered.length === 0 ? (
          // Which of the two emptinesses this is decides whether somebody goes
          // looking for a missing pay statement or stops looking.
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title={filtersApplied ? "No documents match these filters" : emptyTitle}
            body={
              filtersApplied
                ? "Nothing here is filed under that search, type or year. Widen the filters to see the rest."
                : emptyBody
            }
            action={
              filtersApplied ? (
                <LinkButton href={basePath} size="sm">
                  Clear filters
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  {showEmployee && <TH>Employee</TH>}
                  <TH>Document</TH>
                  <TH>Type</TH>
                  <TH>Added</TH>
                  {showEmployee && <TH>Uploaded By</TH>}
                  <TH align="right">
                    <span className="sr-only">Download</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {shown.map((doc) => (
                  <TR key={doc.id}>
                    {showEmployee && <TD>{doc.employee?.user.name ?? "—"}</TD>}
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{doc.title}</TD>
                    <TD>
                      <Badge size="sm">{mimeToLabel(doc.fileType)}</Badge>
                    </TD>
                    {/* Tabular figures: this column is read down, to find the
                        statement for a given fortnight. */}
                    <TD numeric align="left" style={{ color: "var(--text-secondary)" }}>
                      {format(doc.uploadedAt, "MMM d, yyyy")}
                    </TD>
                    {showEmployee && (
                      <TD style={{ color: "var(--text-secondary)" }}>{doc.uploadedBy}</TD>
                    )}
                    <TD align="right">
                      <div className="flex items-center justify-end gap-2">
                        <DownloadLink id={doc.id} title={doc.title} />
                        {canDelete && <DeleteDocumentButton documentId={doc.id} />}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <TableFooter
              shown={shown.length}
              total={filtered.length}
              label={filtered.length === 1 ? "document" : "documents"}
            />

            {/* The kit's footer deliberately carries no pager, so paging is its
                own row — the same one the audit log uses. */}
            {pages > 1 && (
              <div
                className="flex items-center justify-between gap-3 px-4 py-2.5"
                style={{ borderTop: "1px solid var(--stroke-divider)" }}
              >
                <span
                  className="tabular"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                >
                  Page {current} of {pages}
                </span>
                <div className="flex items-center gap-2">
                  {current > 1 && (
                    <LinkButton href={filterHref({ page: String(current - 1) })} size="sm">
                      ← Prev
                    </LinkButton>
                  )}
                  {current < pages && (
                    <LinkButton href={filterHref({ page: String(current + 1) })} size="sm">
                      Next →
                    </LinkButton>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * The type filter's options, built from the documents actually held.
 *
 * <p>Derived rather than hard-coded so the dropdown can never offer a format
 * that returns nothing. Two of the allowed MIME types both label as "Word", so
 * a label that repeats gets its extension back — the filter still matches on
 * the MIME type, which is what the Type column is showing.
 */
function buildTypeOptions(docs: DocumentRow[]): { value: string; label: string }[] {
  const mimes = [...new Set(docs.map((d) => d.fileType))];
  const seen = new Map<string, number>();
  for (const m of mimes) {
    const label = mimeToLabel(m);
    seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  return mimes
    .map((m) => {
      const label = mimeToLabel(m);
      return { value: m, label: (seen.get(label) ?? 0) > 1 ? `${label} (.${mimeToExt(m)})` : label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Download stays a plain anchor rather than LinkButton.
 *
 * <p>The file streams out of an API route, so there is no page for the router
 * to prefetch or transition to, and target=_blank leaves the list on screen
 * behind the download. It borrows the secondary button's palette variables so
 * it hovers like the real thing.
 */
function DownloadLink({ id, title }: { id: string; title: string }) {
  return (
    <a
      href={`/api/documents/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Download ${title}`}
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
      Download
    </a>
  );
}
