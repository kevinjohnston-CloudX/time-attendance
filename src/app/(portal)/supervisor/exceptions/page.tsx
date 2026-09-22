import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getTeamExceptions } from "@/actions/supervisor.actions";
import { ExceptionActionPanel } from "@/components/supervisor/exception-action-panel";
import { ExceptionsFilter } from "@/components/supervisor/exceptions-filter";
import { ExceptionsEmployeeList } from "@/components/supervisor/exceptions-employee-list";
import {
  Badge,
  Card,
  EmptyState,
  FilterBar,
  FilterChip,
  LinkButton,
  PageHeader,
  Toolbar,
  exceptionTone,
} from "@/components/ui";
import { db } from "@/lib/db";
import { format } from "date-fns";
import { ExternalLink, Inbox } from "lucide-react";

/**
 * Exceptions, as the portal design lays out a list screen — with the split
 * pane kept.
 *
 * <p>The design's own exceptions screen is a flat table with a resolve drawer.
 * This one is not, because resolving an exception here means editing that
 * person's punches, and the people who use it work down one employee at a
 * time: open Marcus, clear his four, move on. A table sorted by date makes
 * that four separate trips. So the design's toolbar, record count and
 * exception-type chips sit above the pane rather than above a table.
 */

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH:    "Missing Punch",
  ABSENT:           "Absent",
  MISSED_MEAL:      "Missed Meal",
  SHORT_BREAK:      "Short Break",
  LONG_SHIFT:       "Long Shift",
  UNSCHEDULED_OT:   "Unscheduled OT",
  CONSECUTIVE_DAYS: "Consecutive Days",
  LATE_IN:          "Late In",
  EARLY_OUT:        "Early Out",
  SCAN_DISCREPANCY: "Scan Discrepancy",
};

/**
 * The chip row, in the order it is drawn — roughly what stops a timecard being
 * paid first.
 *
 * <p>Fixed rather than derived from the rows on screen: a chip row built from
 * what is left after filtering collapses to a single chip the moment you pick
 * a type, and then the only way to look at a different type is to go back to
 * "All types" first.
 */
const EXCEPTION_TYPES = Object.keys(EXCEPTION_LABEL);

type Filters = {
  siteId?: string;
  departmentId?: string;
  employeeId?: string;
  exceptionType?: string;
  payPeriodId?: string;
};

/**
 * The same page with one filter changed.
 *
 * <p>Changing a filter drops the selected employee, which is what the filter
 * controls have always done: the person you had open may have nothing left
 * matching, and landing on "nothing open for this person" reads as though
 * their exceptions were resolved.
 */
function hrefWith(current: Filters, patch: Filters): string {
  const next = { ...current, employeeId: undefined, ...patch };
  const params = new URLSearchParams();
  for (const key of ["siteId", "departmentId", "employeeId", "exceptionType", "payPeriodId"] as const) {
    if (next[key]) params.set(key, next[key] as string);
  }
  const qs = params.toString();
  return `/supervisor/exceptions${qs ? `?${qs}` : ""}`;
}

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "TIMESHEET_APPROVE_TEAM")) redirect("/dashboard");

  const { siteId, departmentId, employeeId, exceptionType, payPeriodId } = await searchParams;
  const tenantId = session.user.tenantId as string;
  const now = new Date();

  const [result, sites, departments, rawPayPeriods] = await Promise.all([
    getTeamExceptions({ siteId, departmentId, exceptionType, payPeriodId }),
    db.site.findMany({ where: { tenantId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.department.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(siteId ? { sites: { some: { siteId } } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.payPeriod.findMany({
      where: {
        tenantId,
        timesheets: { some: { exceptions: { some: { resolvedAt: null } } } },
      },
      orderBy: { startDate: "desc" },
      select: { id: true, startDate: true, endDate: true, status: true },
    }),
  ]);

  const payPeriodOptions = rawPayPeriods.map((pp) => {
    const isCurrent = pp.startDate <= now && pp.endDate >= now && pp.status === "OPEN";
    return {
      id: pp.id,
      label: `${format(pp.startDate, "MMM d")} – ${format(pp.endDate, "MMM d, yyyy")}${isCurrent ? " (Current)" : ""}`,
    };
  });

  if (!result.success) redirect("/supervisor");

  const exceptions = result.data;
  const filters: Filters = { siteId, departmentId, employeeId, exceptionType, payPeriodId };

  // Build left-panel employee list (grouped + sorted)
  const empMap = new Map<string, { employeeId: string; name: string; exceptionTypes: string[] }>();
  for (const ex of exceptions) {
    const id = ex.timesheet.employeeId;
    if (!empMap.has(id)) {
      empMap.set(id, {
        employeeId: id,
        name: ex.timesheet.employee.user?.name ?? id,
        exceptionTypes: [],
      });
    }
    const entry = empMap.get(id)!;
    if (!entry.exceptionTypes.includes(ex.exceptionType)) {
      entry.exceptionTypes.push(ex.exceptionType);
    }
  }
  const employeeList = Array.from(empMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Right-panel exceptions (filtered to selected employee if any)
  const visibleExceptions = employeeId
    ? exceptions.filter((ex) => ex.timesheet.employeeId === employeeId)
    : exceptions;

  const selectedEmployee = employeeId ? empMap.get(employeeId) : null;

  const isFiltered = Boolean(siteId || departmentId || exceptionType || payPeriodId);
  const selectedPeriod = payPeriodId ? payPeriodOptions.find((p) => p.id === payPeriodId) : null;
  const selectedSite = siteId ? sites.find((s) => s.id === siteId) : null;
  const selectedDepartment = departmentId ? departments.find((d) => d.id === departmentId) : null;

  /**
   * How many of each type are open.
   *
   * <p>Only meaningful on the unfiltered view: once a type is picked the query
   * has returned that type alone, so every other count would be a zero that is
   * not true. Rather than run a second census query on a page that already
   * loads every exception with its punches, the chips go bare — and the one
   * count that is still known, the selected type's, stays.
   */
  const countByType = new Map<string, number>();
  for (const ex of exceptions) {
    countByType.set(ex.exceptionType, (countByType.get(ex.exceptionType) ?? 0) + 1);
  }

  /**
   * Height arithmetic, because the split pane scrolls its two halves
   * independently and therefore cannot simply grow.
   *
   *   100vh - 56px top bar - 16px main padding-top - 24px padding-bottom
   *
   * The toolbar and chip rows above the pane come out of the same budget, so
   * a floor keeps the pane usable on a short window — below it the page
   * scrolls, which is the lesser evil against a 100px-tall list of people.
   *
   * The super-admin tenant banner is not in this sum; on that one path the
   * pane runs a banner's height past the fold.
   */
  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-[520px] flex-col gap-3">
      <PageHeader
        title="Exceptions"
        subtitle={
          "Missing punches and rule breaks to resolve before close" +
          (selectedPeriod ? ` · ${selectedPeriod.label}` : "")
        }
        actions={
          <ExceptionsFilter
            sites={sites}
            departments={departments}
            payPeriods={payPeriodOptions}
            selectedSiteId={siteId}
            selectedDepartmentId={departmentId}
            selectedExceptionType={exceptionType}
            selectedPayPeriodId={payPeriodId}
          />
        }
      />

      <Toolbar count={exceptions.length} countLabel="open exception">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <TypeChip
            // Already on "All types" — then this chip changes no filter, and
            // it should not quietly close the person you have open either.
            href={exceptionType ? hrefWith(filters, { exceptionType: undefined }) : hrefWith(filters, { employeeId })}
            active={!exceptionType}
          >
            All types
          </TypeChip>
          {EXCEPTION_TYPES.map((type) => {
            const active = exceptionType === type;
            const count = !exceptionType || active ? countByType.get(type) : undefined;
            return (
              <TypeChip
                key={type}
                // Clicking the type you are already on takes it off again —
                // the chips are a filter, not a set of tabs you must be inside.
                href={hrefWith(filters, { exceptionType: active ? undefined : type })}
                active={active}
                count={count}
              >
                {EXCEPTION_LABEL[type]}
              </TypeChip>
            );
          })}
        </div>
      </Toolbar>

      <FilterBar clearHref={isFiltered ? "/supervisor/exceptions" : undefined}>
        {/* Keyed off the parameter, not off the row it resolves to: a filter
            whose id is not in the options list — an inactive site, a period
            with nothing open, a stale link — is still narrowing the list, and
            a chip that disappears is a filter nobody can find to take off. */}
        {payPeriodId && (
          <FilterChip
            key="payPeriodId"
            label="Pay period"
            value={selectedPeriod?.label ?? "Selected period"}
            clearHref={hrefWith(filters, { payPeriodId: undefined })}
          />
        )}
        {siteId && (
          <FilterChip
            key="siteId"
            label="Site"
            value={selectedSite?.name ?? "Selected site"}
            // Departments are listed per site, so the department that was
            // picked under it goes too — otherwise the list silently stays
            // narrowed by a department the new scope may not contain.
            clearHref={hrefWith(filters, { siteId: undefined, departmentId: undefined })}
          />
        )}
        {departmentId && (
          <FilterChip
            key="departmentId"
            label="Department"
            value={selectedDepartment?.name ?? "Selected department"}
            clearHref={hrefWith(filters, { departmentId: undefined })}
          />
        )}
      </FilterBar>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: who has something open */}
        <div
          className="flex w-64 shrink-0 flex-col overflow-hidden"
          style={{
            background: "var(--surface-card)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            className="wms-overline shrink-0 px-3 py-2.5"
            style={{ borderBottom: "1px solid var(--stroke-divider)" }}
          >
            Employees ({employeeList.length})
          </div>
          <ExceptionsEmployeeList
            employees={employeeList.map((emp) => ({
              employeeId: emp.employeeId,
              name: emp.name,
              count: exceptions.filter((ex) => ex.timesheet.employeeId === emp.employeeId).length,
              // Labelled here rather than in the list: the list is a client
              // component, and a second copy of this map is how "Late In" ends
              // up spelled two ways on one screen.
              exceptionTypes: emp.exceptionTypes.map((t) => ({
                value: t,
                label: EXCEPTION_LABEL[t] ?? t,
              })),
            }))}
            totalCount={exceptions.length}
            selectedEmployeeId={employeeId}
            siteId={siteId}
            departmentId={departmentId}
            exceptionType={exceptionType}
            payPeriodId={payPeriodId}
          />
        </div>

        {/* Right: the exceptions themselves */}
        <div
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
          style={{
            background: "var(--surface-page)",
            borderRadius: "var(--radius-l)",
            boxShadow: "inset 0 0 0 1px var(--stroke-divider)",
          }}
        >
          {selectedEmployee && (
            <div
              className="flex shrink-0 items-center gap-2.5 px-4 py-2.5"
              style={{ borderBottom: "1px solid var(--stroke-divider)", background: "var(--surface-card)" }}
            >
              <p style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>
                {selectedEmployee.name}
              </p>
              <Badge tone="warning" size="sm">
                {visibleExceptions.length} open
              </Badge>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            {visibleExceptions.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-8 w-8" />}
                title={
                  employeeId
                    ? "Nothing open for this person"
                    : isFiltered
                      ? "Nothing matches these filters"
                      : "No open exceptions"
                }
                // "Clean" is a claim somebody closes a pay period on, so it is
                // only made when nothing at all is narrowing the list. With a
                // person selected the rest of the team is still off screen —
                // including the case where that employeeId came off a stale
                // link and matches nobody in the current scope.
                body={
                  employeeId
                    ? "Other people in the list on the left may still have exceptions open."
                    : isFiltered
                      ? "There may still be exceptions outside the site, department, type or pay period you have selected."
                      : "Every timecard in range is clean."
                }
                action={
                  employeeId ? (
                    <LinkButton href={hrefWith(filters, {})} hierarchy="secondary" size="sm">
                      Show All Employees
                    </LinkButton>
                  ) : isFiltered ? (
                    <LinkButton href="/supervisor/exceptions" hierarchy="secondary" size="sm">
                      Reset Filters
                    </LinkButton>
                  ) : undefined
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {visibleExceptions.map((ex) => (
                  <Card
                    key={ex.id}
                    // With one person open every card would carry the same
                    // name, so the date takes the title instead — that is what
                    // tells the cards apart on that view.
                    title={
                      employeeId
                        ? format(ex.occurredAt, "EEEE, d MMMM yyyy")
                        : ex.timesheet.employee.user?.name ?? `Employee ${ex.timesheet.employeeId}`
                    }
                    subtitle={[ex.timesheet.employee.site?.name, ex.timesheet.employee.department?.name]
                      .filter(Boolean)
                      .join(" · ")}
                    actions={
                      <LinkButton
                        href={`/payroll/timecards?payPeriodId=${ex.timesheet.payPeriod.id}&employeeId=${ex.timesheet.employeeId}`}
                        size="sm"
                        leadingIcon={<ExternalLink className="h-3.5 w-3.5" />}
                      >
                        View Timecard
                      </LinkButton>
                    }
                  >
                    <div className="flex flex-col gap-2.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Badge tone={exceptionTone(ex.exceptionType)} size="sm">
                          {EXCEPTION_LABEL[ex.exceptionType] ?? ex.exceptionType}
                        </Badge>
                        <span
                          className="tabular"
                          style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                        >
                          {/* The date is already the card's title on a single
                              person's view, so only the time is left to say. */}
                          {format(ex.occurredAt, employeeId ? "h:mm a" : "MMM d, yyyy h:mm a")}
                        </span>
                        <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                          Pay period {format(ex.timesheet.payPeriod.startDate, "MMM d")} –{" "}
                          {format(ex.timesheet.payPeriod.endDate, "MMM d, yyyy")}
                        </span>
                      </div>

                      {ex.description && (
                        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                          {ex.description}
                        </p>
                      )}

                      <ExceptionActionPanel
                        exceptionId={ex.id}
                        exceptionType={ex.exceptionType}
                        timesheetId={ex.timesheetId}
                        occurredAt={ex.occurredAt}
                        punches={ex.timesheet.punches}
                      />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One exception-type chip.
 *
 * <p>An anchor rather than a button: the type belongs in the query string with
 * the other filters, so a supervisor can send "the missing punches at 5903"
 * to someone as a link, and reloading does not drop back to every type.
 */
function TypeChip({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className="ta-chip"
      data-applied={active ? "true" : undefined}
      aria-current={active ? "true" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 12px",
        boxSizing: "border-box",
        whiteSpace: "nowrap",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--stroke-accent)" : "var(--stroke-secondary)"}`,
        background: active ? "var(--wms-color-primary-50)" : "var(--surface-card)",
        font: "var(--type-body2)",
        fontWeight: "var(--weight-medium)",
        color: active ? "var(--text-accent)" : "var(--text-secondary)",
        textDecoration: "none",
      }}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className="tabular"
          style={{
            fontWeight: "var(--weight-semibold)",
            color: active ? "var(--text-accent)" : "var(--text-tertiary)",
          }}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
