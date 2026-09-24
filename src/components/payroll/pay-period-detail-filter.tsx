"use client";

import { useRouter } from "@/components/layout/navigation-progress";
import { Button, FilterSelectChip } from "@/components/ui";
import { SHOW_OPTIONS, type TimesheetShow } from "./pay-period-show";

type Site = { id: string; name: string };
type Dept = { id: string; name: string };

/**
 * Site, department and Show narrowing for the timesheet table, as the same
 * pills Employees and Live Attendance use.
 *
 * <p>All three live in the query string rather than in state. A payroll clerk
 * working one warehouse sends the link to that warehouse's supervisor, and a
 * filter held in React would arrive showing every site.
 *
 * <p>Picking a site clears the department: the department list the page offers
 * is scoped to the chosen site, so keeping the old one would leave a filter
 * applied that is no longer in the list that set it.
 */
export function PayPeriodDetailFilter({
  payPeriodId,
  currentFilter,
  sites,
  departments,
  selectedSiteId,
  selectedDepartmentId,
  show,
}: {
  payPeriodId: string;
  currentFilter: string;
  sites: Site[];
  departments: Dept[];
  selectedSiteId?: string;
  selectedDepartmentId?: string;
  show: TimesheetShow | "";
}) {
  const router = useRouter();

  function go(next: { siteId?: string | null; departmentId?: string | null; show?: string | null }) {
    const params = new URLSearchParams({ id: payPeriodId });
    if (currentFilter !== "all") params.set("filter", currentFilter);
    const site = next.siteId === undefined ? selectedSiteId : next.siteId;
    const dept = next.departmentId === undefined ? selectedDepartmentId : next.departmentId;
    const shown = next.show === undefined ? show : next.show;
    if (site) params.set("siteId", site);
    if (dept) params.set("departmentId", dept);
    if (shown) params.set("show", shown);
    router.push(`/payroll/pay-periods?${params}#timesheets`, { scroll: false });
  }

  const any = Boolean(selectedSiteId || selectedDepartmentId || show);

  return (
    <>
      <FilterSelectChip
        label="Site"
        value={selectedSiteId ?? ""}
        options={sites}
        onChange={(v) => go({ siteId: v || null, departmentId: null })}
      />
      <FilterSelectChip
        label="Department"
        value={selectedDepartmentId ?? ""}
        options={departments}
        onChange={(v) => go({ departmentId: v || null })}
      />
      <FilterSelectChip
        label="Show"
        allLabel="Every timesheet"
        value={show}
        options={SHOW_OPTIONS}
        onChange={(v) => go({ show: v || null })}
      />
      {any && (
        <Button hierarchy="link" size="sm" onClick={() => go({ siteId: null, departmentId: null, show: null })}>
          Clear all
        </Button>
      )}
    </>
  );
}
