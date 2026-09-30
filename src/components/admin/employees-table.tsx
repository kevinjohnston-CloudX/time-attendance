"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "@/components/layout/navigation-progress";
import { useCondensingBar } from "@/components/layout/use-condensing-bar";
import {
  Button,
  EmptyState,
  FilterSelectChip,
  SortSelectChip,
  SearchInput,
  PageHeader,
  PinnedBar,
  ToolsBar,
  ToolsCount,
} from "@/components/ui";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Users } from "lucide-react";
import { Face } from "@/components/presence/face";
import { LIST_COOKIE } from "./employees-list-cookie";
import { LIST_KEYS, MISSING_OPTIONS, PAY_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS } from "./employees-list-options";
import styles from "./employees.module.css";

/**
 * The employee list, in Live Attendance's language: one row of search and
 * filter pills under the title, then a card of two line rows on one grid.
 *
 * <p>Columns are Employee, Employee ID, Department, Shift, Role and Status.
 * Where a column has two facts they stack (name over email, department over
 * site, shift over its start time) so every row has the same rhythm. Status
 * is a dot and a word, the only colour in the row. Role stays plain text.
 *
 * <p>Filters stay where they were, in the query string. A filtered employee
 * list is something HR sends to a supervisor, and it has to survive being
 * pasted into a message. Each pill shows and clears its own value, so there
 * is no second row of applied chips repeating them.
 */

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE:      "Employee",
  SUPERVISOR:    "Supervisor",
  PAYROLL_ADMIN: "Payroll Admin",
  HR_ADMIN:      "HR Admin",
  SYSTEM_ADMIN:  "System Admin",
};

interface Employee {
  id: string;
  employeeCode: string;
  role: string;
  isActive: boolean;
  onLeave: boolean;
  shiftId: string | null;
  user: { name: string | null; email: string | null };
  site: { name: string };
  department: { name: string };
  customRole: { id: string; name: string } | null;
  /** A signed link to the time clock tablet's photo, or null for initials. */
  photo: string | null;
}

type Filters = Record<"q" | "site" | "dept" | "role" | "status" | "shift" | "pay" | "missing" | "sort", string>;

interface Props {
  employees: Employee[];
  total: number;
  page: number;
  pageSize: number;
  sites: string[];
  departments: string[];
  shifts: { id: string; name: string; startTime: string }[];
  currentFilters: Filters;
  /** The page header, pinned together with the filters under it, and slimmed once the page scrolls. */
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function EmployeesTable({
  employees,
  total,
  page,
  pageSize,
  sites,
  departments,
  shifts,
  currentFilters,
  title,
  subtitle,
  actions,
}: Props) {
  const router = useRouter();
  const { barRef, markerRef, condensed, barHeight } = useCondensingBar();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Local state for search input so typing feels instant (debounced URL push)
  const [searchValue, setSearchValue] = useState(currentFilters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local search in sync if the server-driven filter changes (e.g. browser back)
  useEffect(() => { setSearchValue(currentFilters.q); }, [currentFilters.q]);

  const buildUrl = useCallback((overrides: Partial<Filters & { page: number }>) => {
    const params = new URLSearchParams();
    for (const k of LIST_KEYS) {
      if (k === "page") continue;
      const v = overrides[k] ?? currentFilters[k];
      if (v) params.set(k, v);
    }
    const pg = overrides.page ?? 0;
    if (pg) params.set("page", String(pg));
    const qs = params.toString();
    return `/admin/employees${qs ? `?${qs}` : ""}`;
  }, [currentFilters]);

  function navigate(overrides: Partial<Filters & { page: number }>) {
    const url = buildUrl(overrides);
    rememberList(url);
    router.push(url);
  }

  // Clears the search and filters. The sort stays, since it hides nobody.
  function clearAll() {
    setSearchValue("");
    const url = currentFilters.sort ? `/admin/employees?sort=${encodeURIComponent(currentFilters.sort)}` : "/admin/employees";
    rememberList(url);
    router.push(url);
  }

  // The list as it is now is what "back to Employees" should bring back, even
  // when it was reached by a link rather than typed here.
  const currentUrl = buildUrl({ page });
  useEffect(() => {
    rememberList(currentUrl);
  }, [currentUrl]);

  function onSearchChange(val: string) {
    setSearchValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ q: val, page: 0 }), 350);
  }

  function onFilterChange(key: Exclude<keyof Filters, "q">, val: string) {
    navigate({ [key]: val, page: 0 });
  }

  // The sort is not a filter: it hides nobody, so it does not count here.
  const isFiltered = Boolean(
    currentFilters.q || currentFilters.site || currentFilters.dept || currentFilters.role ||
    currentFilters.status || currentFilters.shift || currentFilters.pay || currentFilters.missing,
  );

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const shiftOptions = [...shifts].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ id: s.id, name: s.name }));

  const shown = employees.length;
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = page * pageSize + shown;

  return (
    <div className="relative flex flex-col gap-4">
      <span ref={markerRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px" />
      <PinnedBar barRef={barRef}>
        <PageHeader title={title} subtitle={subtitle} actions={actions} condensed={condensed} />
        {/* The shared tools bar, as on Live Attendance: search first, then the
            filters as flat triggers that show and clear their own value, the
            count and sort on the right. */}
        <ToolsBar
          search={
            <SearchInput
              value={searchValue}
              onValueChange={onSearchChange}
              placeholder="Name, employee ID or badge"
              width={250}
            />
          }
          end={
            <>
              {isFiltered && (
                <Button hierarchy="link" size="sm" onClick={clearAll}>
                  Clear all
                </Button>
              )}
              {/* The count and the sort travel together on the right, so on a
                  narrower window the bar wraps as filters then order, not mid pill. */}
              <span className="flex items-center">
                <ToolsCount>
                  {total.toLocaleString()} {total === 1 ? "employee" : "employees"}
                </ToolsCount>
                <SortSelectChip
                  value={currentFilters.sort}
                  options={SORT_OPTIONS}
                  onChange={(v) => onFilterChange("sort", v)}
                />
              </span>
            </>
          }
        >
            <FilterSelectChip
              label="Site"
              value={currentFilters.site}
              options={sites.map((s) => ({ id: s, name: s }))}
              onChange={(v) => onFilterChange("site", v)}
            />
            <FilterSelectChip
              label="Department"
              value={currentFilters.dept}
              options={departments.map((d) => ({ id: d, name: d }))}
              onChange={(v) => onFilterChange("dept", v)}
            />
            <FilterSelectChip
              label="Role"
              value={currentFilters.role}
              options={Object.entries(ROLE_LABEL).map(([id, name]) => ({ id, name }))}
              onChange={(v) => onFilterChange("role", v)}
            />
            <FilterSelectChip
              label="Status"
              allLabel="All statuses"
              value={currentFilters.status}
              options={STATUS_OPTIONS}
              onChange={(v) => onFilterChange("status", v)}
            />
            <FilterSelectChip
              label="Shift"
              value={currentFilters.shift}
              options={shiftOptions}
              onChange={(v) => onFilterChange("shift", v)}
            />
            <FilterSelectChip
              label="Pay method"
              value={currentFilters.pay}
              options={PAY_OPTIONS}
              onChange={(v) => onFilterChange("pay", v)}
            />
            <FilterSelectChip
              label="Missing"
              allLabel="Any record"
              value={currentFilters.missing}
              options={MISSING_OPTIONS}
              onChange={(v) => onFilterChange("missing", v)}
            />
        </ToolsBar>
      </PinnedBar>

      <section className={styles.panel} aria-label="Employees">
        {employees.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title={isFiltered ? "No employees match these filters" : "No employees"}
            body={
              isFiltered
                ? "Try a wider search, or clear some of the filters."
                : undefined
            }
            action={
              isFiltered ? (
                <Button
                  size="sm"
                  hierarchy="secondary"
                  onClick={clearAll}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className={styles.head} style={{ top: barHeight }} role="presentation">
              <span>Employee</span>
              <span className={styles.wide}>Employee ID</span>
              <span className={styles.wide}>Department</span>
              <span className={styles.optional}>Shift</span>
              <span className={styles.optional}>Role</span>
              <span>Status</span>
              <span />
            </div>
            <ul className={styles.list}>
              {employees.map((emp) => {
                const shift = emp.shiftId ? shiftById.get(emp.shiftId) : undefined;
                const name = emp.user.name ?? emp.employeeCode;
                const role = emp.customRole ? emp.customRole.name : ROLE_LABEL[emp.role] ?? emp.role;
                const tone = !emp.isActive ? "inactive" : emp.onLeave ? "leave" : "active";
                return (
                  <li key={emp.id}>
                    {/* The whole row is the link, so middle click and "open in
                        new tab" work on a list HR walks down. */}
                    <Link
                      href={`/admin/employees/${emp.id}`}
                      className={styles.row}
                      data-inactive={emp.isActive ? undefined : "true"}
                      aria-label={`Open ${name}`}
                    >
                      <span className={styles.who}>
                        {/* The tablet photo over the initials, which show when
                            there is no photo or it fails to load. */}
                        <span className={styles.avatar} aria-hidden="true">
                          {initialsOf(emp.user.name)}
                          <Face src={emp.photo} personId={emp.id} />
                        </span>
                        <span className={styles.cell}>
                          <span className={styles.name} title={name}>{name}</span>
                          {emp.user.email && (
                            <span className={styles.sub} title={emp.user.email}>{emp.user.email}</span>
                          )}
                        </span>
                      </span>
                      <span className={`${styles.code} ${styles.wide}`} title={emp.employeeCode}>
                        {emp.employeeCode}
                      </span>
                      <span className={`${styles.cell} ${styles.wide}`}>
                        <span className={styles.secondary} title={emp.department.name}>{emp.department.name}</span>
                        <span className={styles.sub} title={emp.site.name}>{emp.site.name}</span>
                      </span>
                      <span className={`${styles.cell} ${styles.optional}`}>
                        {shift ? (
                          <>
                            <span className={styles.secondary} title={shift.name}>{shift.name}</span>
                            <span className={`${styles.sub} tabular`}>Starts {clock12(shift.startTime)}</span>
                          </>
                        ) : emp.shiftId ? (
                          // The lookup only carries active shifts, so an
                          // employee left on a retired one has to say that
                          // rather than read as unscheduled.
                          <span className={styles.muted}>Retired shift</span>
                        ) : (
                          <span className={styles.muted}>No shift</span>
                        )}
                      </span>
                      <span className={`${styles.secondary} ${styles.optional}`} title={role}>{role}</span>
                      <span className={styles.status} data-tone={tone}>
                        <span className={styles.dot} aria-hidden="true" />
                        {tone === "inactive" ? "Inactive" : tone === "leave" ? "On leave" : "Active"}
                      </span>
                      <ChevronRight className={styles.chevron} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className={styles.footer}>
              <span className="tabular">
                {shown === total
                  ? `${total.toLocaleString()} ${total === 1 ? "employee" : "employees"}`
                  : `${firstRow.toLocaleString()} to ${lastRow.toLocaleString()} of ${total.toLocaleString()} employees`}
              </span>
              {totalPages > 1 && (
                <div className={styles.pager}>
                  <Button
                    size="sm"
                    hierarchy="tertiary"
                    iconOnly
                    aria-label="First page"
                    title="First page"
                    onClick={() => navigate({ page: 0 })}
                    disabled={page === 0}
                  >
                    <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    hierarchy="tertiary"
                    iconOnly
                    aria-label="Previous page"
                    title="Previous page"
                    onClick={() => navigate({ page: page - 1 })}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span className={`${styles.pageOf} tabular`}>
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    hierarchy="tertiary"
                    iconOnly
                    aria-label="Next page"
                    title="Next page"
                    onClick={() => navigate({ page: page + 1 })}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    hierarchy="tertiary"
                    iconOnly
                    aria-label="Last page"
                    title="Last page"
                    onClick={() => navigate({ page: totalPages - 1 })}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronsRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Remembers the list's search, filters and page for this browser session, in
 * a cookie the list page reads when it is opened bare (from the record's back
 * link, the breadcrumb or the sidebar), so coming back does not mean typing
 * the search again. Clear all forgets it. Only this browser ever sees it.
 */
function rememberList(url: string) {
  const qs = url.split("?")[1] ?? "";
  try {
    document.cookie = qs
      ? `${LIST_COOKIE}=${encodeURIComponent(qs)}; path=/admin/employees; samesite=lax`
      : `${LIST_COOKIE}=; path=/admin/employees; max-age=0; samesite=lax`;
  } catch {
    // Cookies blocked: the list simply opens unfiltered, as before.
  }
}

/** Two letters for the circle beside a name: first and last word. */
function initialsOf(name: string | null): string {
  const words = (name ?? "").replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** A stored "HH:MM" start time on the 12 hour clock, as every screen shows time. */
function clock12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
