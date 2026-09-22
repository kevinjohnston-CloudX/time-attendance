import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamTimesheets } from "@/actions/supervisor.actions";
import { TIMESHEET_STATUS_LABEL } from "@/lib/state-machines/labels";
import { ApproveTimesheetButtons } from "@/components/supervisor/approve-timesheet-buttons";
import { parseUtcDate } from "@/lib/utils/date";
import {
  Badge,
  Card,
  EmptyState,
  FilterBar,
  FilterChip,
  LinkButton,
  PageHeader,
  SegmentedLinks,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableFooter,
  Toolbar,
  statusTone,
} from "@/components/ui";
import { format, addDays } from "date-fns";
import { ClipboardCheck, Search } from "lucide-react";

/**
 * The approval queue, as the portal design's list screen (Template A).
 *
 * <p>This used to be a stack of cards, one per timesheet. A queue is read by
 * comparing rows — whose overtime is unusual, who has exceptions — and cards
 * put every number on its own baseline, so the comparison had to be done by
 * eye across 300px of vertical space. It is a table now.
 *
 * <p>The view filter and the search narrow what is already loaded rather than
 * re-querying. The query behind this page is permission-scoped — a supervisor
 * sees their own team's SUBMITTED sheets, payroll sees every SUP_APPROVED one
 * — and a tab that changed the query would quietly change which of those two
 * sets you are looking at.
 *
 * <p>Which is also why two of the design's four view tabs are missing. Every
 * row this page can load is already a row waiting on the viewer, so "Needs
 * approval" would be a second copy of All; and no approved sheet is ever
 * loaded, so "Approved" would always be empty. The one thing the loaded rows
 * genuinely answer is whether they carry open exceptions, so that is the
 * split, offered in both directions — Clean is the set "Approve All Clean"
 * would act on, if this codebase had it.
 */

type View = "all" | "issues" | "clean";

const VIEW_LABEL: Record<View, string> = {
  all: "All",
  issues: "Exceptions",
  clean: "Clean",
};

export default async function TeamTimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const isPayroll = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"].includes(
    session.user.role
  );

  const result = await getTeamTimesheets();
  if (!result.success) redirect("/supervisor");

  const all = result.data;
  const { view: rawView, q: rawQuery } = (await searchParams) ?? {};
  const view: View = rawView === "issues" || rawView === "clean" ? rawView : "all";
  const query = (rawQuery ?? "").trim();

  // Matched against the employee code as well as the displayed name: the code
  // is what an ADP export or a badge hands you, and it is already on the row.
  const term = query.toLowerCase();
  const searched = term
    ? all.filter((ts) =>
        `${ts.employee.user?.name ?? ""} ${ts.employee.employeeCode}`.toLowerCase().includes(term),
      )
    : all;

  const withIssues = searched.filter((ts) => ts.exceptions.length > 0);
  const clean = searched.filter((ts) => ts.exceptions.length === 0);
  const rows = view === "issues" ? withIssues : view === "clean" ? clean : searched;

  /** Both filters live in the URL, so every link has to carry the other one. */
  const href = (v: View, q: string) => {
    const params = new URLSearchParams();
    if (v !== "all") params.set("view", v);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/supervisor/timesheets?${qs}` : "/supervisor/timesheets";
  };
  const unfiltered = href("all", "");
  const isNarrowed = view !== "all" || query !== "";

  return (
    <div className="flex flex-col gap-4">
      {/* The "← Team Portal" link is gone: the breadcrumb in the top bar and
          Team Overview in the sidebar both do that job now. */}
      <PageHeader
        title="Team Timesheets"
        subtitle={
          all.length === 0
            ? isPayroll
              ? "Nothing waiting on payroll"
              : "Nothing waiting on you"
            : isPayroll
              ? `${all.length} supervisor-approved ${all.length === 1 ? "timesheet is" : "timesheets are"} waiting on payroll`
              : `${all.length} ${all.length === 1 ? "timesheet is" : "timesheets are"} waiting on your approval`
        }
      />

      <div className="flex flex-col gap-2.5">
        <Toolbar count={rows.length} countLabel="timesheet">
          <SegmentedLinks
            ariaLabel="Filter timesheets"
            size="sm"
            active={view}
            items={[
              { value: "all", label: VIEW_LABEL.all, href: href("all", query), count: searched.length },
              { value: "issues", label: VIEW_LABEL.issues, href: href("issues", query), count: withIssues.length },
              { value: "clean", label: VIEW_LABEL.clean, href: href("clean", query), count: clean.length },
            ]}
          />

          {/* A plain GET form rather than the kit's SearchInput: this page is a
              server component, and a narrowed queue has to survive a reload and
              be sendable to somebody. Styled to match SearchInput because it is
              the same control; the hidden field is what stops searching from
              throwing you back to the All tab. */}
          <form method="GET" role="search" style={{ flex: "0 1 260px", minWidth: 180 }}>
            {view !== "all" && <input type="hidden" name="view" value={view} />}
            <label
              className="ta-field flex h-8 w-full items-center gap-2 rounded-md px-2.5"
              style={{
                border: "1px solid var(--stroke-default)",
                background: "var(--surface-card)",
              }}
            >
              <Search className="h-4 w-4 flex-none" style={{ color: "var(--icon-tertiary)" }} />
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Employee name or code"
                aria-label="Search this queue"
                className="min-w-0 flex-1 border-0 bg-transparent outline-none"
                style={{ font: "var(--type-body1)", color: "var(--text-primary)" }}
              />
            </label>
          </form>
        </Toolbar>

        <FilterBar clearHref={isNarrowed ? unfiltered : undefined}>
          {view !== "all" ? (
            <FilterChip
              key="view"
              label="View"
              value={VIEW_LABEL[view]}
              clearHref={href("all", query)}
            />
          ) : null}
          {query ? (
            <FilterChip key="q" label="Search" value={query} clearHref={href(view, "")} />
          ) : null}
        </FilterBar>

        <Card padding={0}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={32} />}
              title={all.length === 0 ? "Nothing pending review" : "Nothing in this view"}
              body={
                all.length === 0
                  ? isPayroll
                    ? "Timesheets appear here once a supervisor has approved them."
                    : "Timesheets appear here once employees submit them."
                  : query
                    ? `No timesheet in this queue matches “${query}”.`
                    : "Every timesheet in this queue is in one of the other views."
              }
              action={
                isNarrowed ? (
                  <LinkButton href={unfiltered} hierarchy="secondary" size="sm">
                    Reset filters
                  </LinkButton>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Employee</TH>
                    <TH>Pay period</TH>
                    <TH numeric>Hours</TH>
                    <TH align="center">Issues</TH>
                    <TH>Status</TH>
                    <TH align="right">Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((ts) => {
                    const reg = ts.overtimeBuckets.find((b) => b.bucket === "REG")?.totalMinutes ?? 0;
                    const ot = ts.overtimeBuckets.find((b) => b.bucket === "OT")?.totalMinutes ?? 0;
                    const dt = ts.overtimeBuckets.find((b) => b.bucket === "DT")?.totalMinutes ?? 0;

                    return (
                      <TR key={ts.id}>
                        <TD>
                          <span style={{ fontWeight: "var(--weight-medium)", whiteSpace: "nowrap" }}>
                            {ts.employee.user?.name ?? `Employee ${ts.employee.employeeCode}`}
                          </span>
                        </TD>
                        <TD style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          {format(parseUtcDate(ts.payPeriod.startDate), "MMM d")} –{" "}
                          {format(addDays(parseUtcDate(ts.payPeriod.endDate), -1), "MMM d, yyyy")}
                        </TD>
                        {/* Regular hours carry the column and overtime hangs
                            underneath, as the design draws it. Three equal
                            columns spent a third of the table on two figures
                            that are empty on most rows. */}
                        <TD numeric>
                          <span className="inline-flex flex-col items-end">
                            <span style={{ fontWeight: "var(--weight-medium)" }}>
                              {(reg / 60).toFixed(2)}
                            </span>
                            {/* These restate the cell's tabular figures: the
                                `font` shorthand resets font-variant-numeric,
                                and an OT column whose decimal points do not
                                line up is one nobody reads down. */}
                            {ot > 0 && (
                              <span
                                style={{
                                  font: "var(--type-caption1)",
                                  fontVariantNumeric: "tabular-nums",
                                  color: "var(--text-warning)",
                                }}
                              >
                                OT {(ot / 60).toFixed(2)}
                              </span>
                            )}
                            {dt > 0 && (
                              <span
                                style={{
                                  font: "var(--type-caption1)",
                                  fontVariantNumeric: "tabular-nums",
                                  color: "var(--text-error)",
                                }}
                              >
                                DT {(dt / 60).toFixed(2)}
                              </span>
                            )}
                          </span>
                        </TD>
                        <TD align="center">
                          {ts.exceptions.length > 0 ? (
                            <Badge tone="error" size="sm">
                              {ts.exceptions.length} open
                            </Badge>
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>—</span>
                          )}
                        </TD>
                        <TD>
                          <Badge tone={statusTone(ts.status)} size="sm">
                            {TIMESHEET_STATUS_LABEL[ts.status]}
                          </Badge>
                        </TD>
                        <TD align="right">
                          <div className="flex justify-end">
                            <ApproveTimesheetButtons
                              timesheetId={ts.id}
                              status={ts.status}
                              isPayroll={isPayroll}
                            />
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              <TableFooter shown={rows.length} total={all.length} label="timesheets" />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
