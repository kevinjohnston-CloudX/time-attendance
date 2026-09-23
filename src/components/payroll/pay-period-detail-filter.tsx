"use client";

import { useRouter } from "@/components/layout/navigation-progress";
import { Select } from "@/components/ui";

type Site = { id: string; name: string };
type Dept = { id: string; name: string };

/**
 * Site and department narrowing for the timesheet table, as the design's
 * card-header controls.
 *
 * <p>Both live in the query string rather than in state. A payroll clerk
 * working one warehouse sends the link to that warehouse's supervisor, and a
 * filter held in React would arrive showing every site.
 *
 * <p>Picking a site clears the department: the department list the page offers
 * is scoped to the chosen site, so keeping the old one would leave a filter
 * applied that is no longer in the dropdown that set it.
 */
export function PayPeriodDetailFilter({
  payPeriodId,
  currentFilter,
  sites,
  departments,
  selectedSiteId,
  selectedDepartmentId,
}: {
  payPeriodId: string;
  currentFilter: string;
  sites: Site[];
  departments: Dept[];
  selectedSiteId?: string;
  selectedDepartmentId?: string;
}) {
  const router = useRouter();

  function buildUrl(siteId: string | null, deptId: string | null) {
    const params = new URLSearchParams({ id: payPeriodId });
    if (currentFilter !== "all") params.set("filter", currentFilter);
    if (siteId) params.set("siteId", siteId);
    if (deptId) params.set("departmentId", deptId);
    return `/payroll/pay-periods?${params}`;
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Filter timesheets by site"
        value={selectedSiteId ?? ""}
        onChange={(e) => router.push(buildUrl(e.target.value || null, null))}
      >
        <option value="">All Sites</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter timesheets by department"
        value={selectedDepartmentId ?? ""}
        onChange={(e) => router.push(buildUrl(selectedSiteId ?? null, e.target.value || null))}
      >
        <option value="">All Departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
