"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterBar,
  FilterChip,
  LinkButton,
  SearchInput,
  Select,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  Toolbar,
  statusTone,
  PinnedBar,
} from "@/components/ui";
import { Users } from "lucide-react";

/**
 * The employee list, on the design's list template: toolbar, applied-filter
 * chips, then the table in a padding-free card.
 *
 * <p>Columns are the design's — Employee, Employee ID, Department, Shift, Role,
 * Status — which means Role is plain text. It was a badge coloured by a local
 * map with no dark-mode entries, and colouring five roles differently made the
 * one column that does carry a warning, Status, compete with four that never do.
 *
 * <p>Filters stay where they were, in the query string. A filtered employee
 * list is something HR sends to a supervisor, and it has to survive being
 * pasted into a message.
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
}

interface Props {
  employees: Employee[];
  total: number;
  page: number;
  pageSize: number;
  sites: string[];
  departments: string[];
  shifts: { id: string; name: string; startTime: string }[];
  currentFilters: { q: string; site: string; dept: string; role: string };
  /** The page title, pinned together with the filters under it. */
  header?: ReactNode;
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
  header,
}: Props) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Local state for search input so typing feels instant (debounced URL push)
  const [searchValue, setSearchValue] = useState(currentFilters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local search in sync if the server-driven filter changes (e.g. browser back)
  useEffect(() => { setSearchValue(currentFilters.q); }, [currentFilters.q]);

  const buildUrl = useCallback((overrides: Partial<typeof currentFilters & { page: number }>) => {
    const params = new URLSearchParams();
    const q    = overrides.q    ?? currentFilters.q;
    const site = overrides.site ?? currentFilters.site;
    const dept = overrides.dept ?? currentFilters.dept;
    const role = overrides.role ?? currentFilters.role;
    const pg   = overrides.page ?? 0;
    if (q)    params.set("q",    q);
    if (site) params.set("site", site);
    if (dept) params.set("dept", dept);
    if (role) params.set("role", role);
    if (pg)   params.set("page", String(pg));
    const qs = params.toString();
    return `/admin/employees${qs ? `?${qs}` : ""}`;
  }, [currentFilters]);

  function navigate(overrides: Partial<typeof currentFilters & { page: number }>) {
    router.push(buildUrl(overrides));
  }

  function onSearchChange(val: string) {
    setSearchValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ q: val, page: 0 }), 350);
  }

  function onFilterChange(key: "site" | "dept" | "role", val: string) {
    navigate({ [key]: val, page: 0 });
  }

  const isFiltered = Boolean(
    currentFilters.q || currentFilters.site || currentFilters.dept || currentFilters.role,
  );

  // Clearing one chip has to keep the other three, and drop the page with them
  // — page 4 of an unfiltered list is a different set of people from page 4 of
  // a filtered one.
  const clearOne = (key: "q" | "site" | "dept" | "role") => buildUrl({ [key]: "", page: 0 });

  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  const shown = employees.length;
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = page * pageSize + shown;

  return (
    <div className="flex flex-col gap-4">
      <PinnedBar>
        {header}
        <div className="flex flex-col gap-2.5">
          <Toolbar count={total} countLabel="employee">
            <SearchInput
              value={searchValue}
              onValueChange={onSearchChange}
              placeholder="Name, email or employee code"
            />
            <Select
              aria-label="Site"
              value={currentFilters.site}
              onChange={(e) => onFilterChange("site", e.target.value)}
            >
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
            <Select
              aria-label="Department"
              value={currentFilters.dept}
              onChange={(e) => onFilterChange("dept", e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
            <Select
              aria-label="Role"
              value={currentFilters.role}
              onChange={(e) => onFilterChange("role", e.target.value)}
            >
              <option value="">All roles</option>
              {Object.entries(ROLE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Toolbar>

          <FilterBar clearHref={isFiltered ? "/admin/employees" : undefined}>
            {currentFilters.site
              ? <FilterChip key="site" label="Site" value={currentFilters.site} clearHref={clearOne("site")} />
              : null}
            {currentFilters.dept
              ? <FilterChip key="dept" label="Department" value={currentFilters.dept} clearHref={clearOne("dept")} />
              : null}
            {currentFilters.role
              ? <FilterChip
                  key="role"
                  label="Role"
                  value={ROLE_LABEL[currentFilters.role] ?? currentFilters.role}
                  clearHref={clearOne("role")}
                />
              : null}
            {currentFilters.q
              ? <FilterChip key="q" label="Search" value={currentFilters.q} clearHref={clearOne("q")} />
              : null}
          </FilterBar>
        </div>
      </PinnedBar>

      <Card padding={0}>
        {employees.length === 0 ? (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title={isFiltered ? "No employees match these filters" : "No employees"}
            body={
              isFiltered
                ? "Try a wider search, or clear the site, department and role filters."
                : undefined
            }
            action={
              isFiltered ? (
                <Button
                  size="sm"
                  hierarchy="secondary"
                  onClick={() => router.push("/admin/employees")}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Employee ID</TH>
                  <TH>Department</TH>
                  <TH>Shift</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH align="right" />
                </TR>
              </THead>
              <TBody>
                {employees.map((emp) => {
                  const shift = emp.shiftId ? shiftById.get(emp.shiftId) : undefined;
                  const href = `/admin/employees/${emp.id}`;
                  return (
                    <TR key={emp.id} onClick={() => router.push(href)}>
                      <TD>
                        <span className="flex flex-col">
                          <span style={{ fontWeight: "var(--weight-medium)", whiteSpace: "nowrap" }}>
                            {emp.user.name}
                          </span>
                          {emp.user.email && (
                            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                              {emp.user.email}
                            </span>
                          )}
                        </span>
                      </TD>
                      <TD
                        style={{
                          fontFamily: "var(--font-mono)",
                          font: "var(--type-body2)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {emp.employeeCode}
                      </TD>
                      <TD style={{ color: "var(--text-secondary)" }}>
                        {emp.department.name}
                        <span style={{ color: "var(--text-tertiary)" }}> · {emp.site.name}</span>
                      </TD>
                      <TD style={{ color: "var(--text-secondary)" }}>
                        {shift ? (
                          <>
                            {shift.name}
                            {/* 24-hour, as the shift itself is stored and as the
                                shift editor shows it — a night shift written
                                "10:00 PM" in one screen and "22:00" in the next
                                is how the wrong one gets assigned. */}
                            <span className="tabular" style={{ color: "var(--text-tertiary)" }}>
                              {" "}({shift.startTime})
                            </span>
                          </>
                        ) : emp.shiftId ? (
                          // The lookup only carries active shifts, so an
                          // employee left on a retired one has to say that
                          // rather than read as unscheduled.
                          <span style={{ color: "var(--text-tertiary)" }}>Retired shift</span>
                        ) : (
                          <span style={{ color: "var(--text-tertiary)" }}>—</span>
                        )}
                      </TD>
                      <TD style={{ color: "var(--text-secondary)" }}>
                        {emp.customRole ? emp.customRole.name : ROLE_LABEL[emp.role] ?? emp.role}
                      </TD>
                      <TD>
                        {!emp.isActive ? (
                          // statusTone has no employment branch: it would answer
                          // "warning" here, and an amber pill on someone who left
                          // in 2023 reads as something to action. The design puts
                          // Terminated and Inactive in neutral, which is Badge's
                          // own default — no local map either way.
                          <Badge size="sm">Inactive</Badge>
                        ) : emp.onLeave ? (
                          <Badge tone="warning" size="sm" dot>On Leave</Badge>
                        ) : (
                          <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                        )}
                      </TD>
                      <TD align="right">
                        {/* An anchor, not the row handler, so middle-click and
                            "open in new tab" work on a list HR walks down.
                            The click must stop here: the row's own handler sits
                            on the <tr>, and without this a ctrl-click opens the
                            record in a new tab *and* navigates the tab you were
                            reading away from the filtered list. */}
                        <span
                          className="inline-flex"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <LinkButton href={href} hierarchy="secondary" size="sm">
                            Open
                          </LinkButton>
                        </span>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>

            <div
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              style={{
                borderTop: "1px solid var(--stroke-divider)",
                font: "var(--type-body2)",
                color: "var(--text-secondary)",
              }}
            >
              <span className="tabular">
                {shown === total
                  ? `${total.toLocaleString()} ${total === 1 ? "employee" : "employees"}`
                  : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${total.toLocaleString()} employees`}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <Button size="sm" hierarchy="tertiary" onClick={() => navigate({ page: 0 })} disabled={page === 0}>
                    «
                  </Button>
                  <Button size="sm" hierarchy="tertiary" onClick={() => navigate({ page: page - 1 })} disabled={page === 0}>
                    ‹ Prev
                  </Button>
                  <span className="tabular px-1" style={{ color: "var(--text-tertiary)" }}>
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    hierarchy="tertiary"
                    onClick={() => navigate({ page: page + 1 })}
                    disabled={page >= totalPages - 1}
                  >
                    Next ›
                  </Button>
                  <Button
                    size="sm"
                    hierarchy="tertiary"
                    onClick={() => navigate({ page: totalPages - 1 })}
                    disabled={page >= totalPages - 1}
                  >
                    »
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
