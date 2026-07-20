"use client";

import { useRouter } from "next/navigation";

type Site = { id: string; name: string };
type Dept = { id: string; name: string };

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

  const selectClass =
    "h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedSiteId ?? ""}
        onChange={(e) => router.push(buildUrl(e.target.value || null, null))}
        className={selectClass}
      >
        <option value="">All Sites</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        value={selectedDepartmentId ?? ""}
        onChange={(e) =>
          router.push(buildUrl(selectedSiteId ?? null, e.target.value || null))
        }
        className={selectClass}
      >
        <option value="">All Departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
