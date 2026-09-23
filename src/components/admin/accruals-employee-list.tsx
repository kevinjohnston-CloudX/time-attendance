"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import Link from "next/link";
import { Hourglass } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterBar,
  FilterChip,
  SearchInput,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableFooter,
  Toolbar,
  statusTone,
} from "@/components/ui";

/**
 * Who to open an accrual ledger for, on the design's list template.
 *
 * <p>The rows are whatever the server was already allowed to send — this
 * component narrows them, it never asks for more. What changed is where the
 * narrowing is written down: it used to be three pieces of React state, so a
 * list filtered to one site was gone on reload and could not be sent to
 * anybody. It is now the query string, like every other list in the product.
 *
 * <p>The footer carries "showing n of N" rather than just n. This page opens
 * on active employees only, and without the second number a short list is
 * indistinguishable from a small team.
 */

type EmployeeRow = {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
  siteId: string;
  site: string;
  isActive: boolean;
  payCategory: string | null;
  hireDate: string | null;
};

type SiteOption = { id: string; name: string };

type Filters = { q: string; site: string; dept: string; status: string };

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  all: "All",
};

export function AccrualsEmployeeList({
  employees,
  total,
  sites,
  departments,
  filters,
}: {
  /** Already narrowed by the server to the applied filters. */
  employees: EmployeeRow[];
  /** Everything the viewer is scoped to, before any filter. */
  total: number;
  sites: SiteOption[];
  departments: string[];
  filters: Filters;
}) {
  const router = useRouter();

  // Typing has to feel immediate, so the box is local and the URL catches up.
  const [searchValue, setSearchValue] = useState(filters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Browser back changes the URL without remounting this component.
  useEffect(() => { setSearchValue(filters.q); }, [filters.q]);

  const buildUrl = useCallback(
    (overrides: Partial<Filters>) => {
      const params = new URLSearchParams();
      const q      = overrides.q      ?? filters.q;
      const site   = overrides.site   ?? filters.site;
      const dept   = overrides.dept   ?? filters.dept;
      const status = overrides.status ?? filters.status;
      if (q)    params.set("q", q);
      if (site) params.set("site", site);
      if (dept) params.set("dept", dept);
      // "active" is the default view, so it stays out of the URL — otherwise
      // every link off this page carries a parameter that changes nothing.
      if (status && status !== "active") params.set("status", status);
      const qs = params.toString();
      return `/accruals${qs ? `?${qs}` : ""}`;
    },
    [filters],
  );

  function navigate(overrides: Partial<Filters>) {
    router.push(buildUrl(overrides));
  }

  function onSearchChange(val: string) {
    setSearchValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ q: val }), 350);
  }

  const isFiltered = Boolean(
    filters.q || filters.site || filters.dept || filters.status !== "active",
  );

  /** Clearing one chip keeps the other three. */
  const clearOne = (key: keyof Filters) =>
    buildUrl({ [key]: key === "status" ? "active" : "" } as Partial<Filters>);

  const siteName = sites.find((s) => s.id === filters.site)?.name ?? filters.site;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <Toolbar count={employees.length} countLabel="employee">
          <SearchInput
            value={searchValue}
            onValueChange={onSearchChange}
            placeholder="Name, employee code or department"
          />
          {sites.length > 1 && (
            <Select
              aria-label="Site"
              value={filters.site}
              onChange={(e) => navigate({ site: e.target.value })}
            >
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          )}
          {departments.length > 1 && (
            <Select
              aria-label="Department"
              value={filters.dept}
              onChange={(e) => navigate({ dept: e.target.value })}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          )}
          <Select
            aria-label="Status"
            value={filters.status}
            onChange={(e) => navigate({ status: e.target.value })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </Toolbar>

        <FilterBar clearHref={isFiltered ? "/accruals" : undefined}>
          {filters.site
            ? <FilterChip key="site" label="Site" value={siteName} clearHref={clearOne("site")} />
            : null}
          {filters.dept
            ? <FilterChip key="dept" label="Department" value={filters.dept} clearHref={clearOne("dept")} />
            : null}
          {filters.status !== "active"
            ? <FilterChip
                key="status"
                label="Status"
                value={STATUS_LABEL[filters.status] ?? filters.status}
                clearHref={clearOne("status")}
              />
            : null}
          {filters.q
            ? <FilterChip key="q" label="Search" value={filters.q} clearHref={clearOne("q")} />
            : null}
        </FilterBar>
      </div>

      <Card padding={0}>
        {employees.length === 0 ? (
          // "Active" is this page's default view, so it stays out of the URL
          // and out of `isFiltered` — but it still hides rows, and an empty
          // list under it must not claim there is nobody to show. A supervisor
          // whose only report was terminated would read "nobody is assigned to
          // you" as the roster being wrong rather than as a filter being on.
          <EmptyState
            icon={<Hourglass className="h-8 w-8" />}
            title={total === 0 ? "No employees" : "No employees match this view"}
            body={
              total === 0
                ? "There is nobody here to open an accrual ledger for."
                : `None of the ${total} employees you can see are shown${
                    filters.status === "active" ? " — this page opens on active employees only" : ""
                  }. Try a wider search, or clear the filters.`
            }
            action={
              total > 0 ? (
                <Button
                  size="sm"
                  hierarchy="secondary"
                  onClick={() => router.push(buildUrl({ q: "", site: "", dept: "", status: "all" }))}
                >
                  Show all employees
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
                  <TH>Pay Category</TH>
                  <TH>Hired</TH>
                  <TH>Status</TH>
                  <TH align="right" />
                </TR>
              </THead>
              <TBody>
                {employees.map((emp) => {
                  const href = `/accruals/${emp.id}`;
                  return (
                    <TR key={emp.id} onClick={() => router.push(href)}>
                      <TD style={{ fontWeight: "var(--weight-medium)", whiteSpace: "nowrap" }}>
                        {emp.name}
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
                        {emp.department}
                        <span style={{ color: "var(--text-tertiary)" }}> · {emp.site}</span>
                      </TD>
                      {/* The pay category is what carries the PTO policies, so
                          "no category" is the reason a ledger further in shows
                          no accrual rate at all. */}
                      <TD style={{ color: "var(--text-secondary)" }}>
                        {emp.payCategory ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                      </TD>
                      <TD className="tabular" style={{ color: "var(--text-secondary)" }}>
                        {emp.hireDate ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                      </TD>
                      <TD>
                        {emp.isActive ? (
                          <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                        ) : (
                          // Neutral, which is Badge's default: statusTone has no
                          // employment branch and would answer "warning", and an
                          // amber pill on somebody who left reads as an action.
                          <Badge size="sm">Inactive</Badge>
                        )}
                      </TD>
                      <TD align="right">
                        {/* A real anchor rather than the row handler, so the
                            ledger can be middle-clicked into its own tab. */}
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="wms-btn wms-btn-link"
                          style={{ font: "var(--type-button2)", color: "var(--link-accent)" }}
                        >
                          Ledger
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <TableFooter shown={employees.length} total={total} label="employees" />
          </>
        )}
      </Card>
    </div>
  );
}
