"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

const ROLE_BADGE: Record<string, string> = {
  EMPLOYEE: "bg-zinc-100 text-zinc-600",
  SUPERVISOR: "bg-blue-100 text-blue-700",
  PAYROLL_ADMIN: "bg-purple-100 text-purple-700",
  HR_ADMIN: "bg-amber-100 text-amber-700",
  SYSTEM_ADMIN: "bg-red-100 text-red-700",
};

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: "Employee",
  SUPERVISOR: "Supervisor",
  PAYROLL_ADMIN: "Payroll Admin",
  HR_ADMIN: "HR Admin",
  SYSTEM_ADMIN: "System Admin",
};

interface Employee {
  id: string;
  employeeCode: string;
  role: string;
  isActive: boolean;
  onLeave: boolean;
  hireDate: Date;
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
  currentFilters: { q: string; site: string; dept: string; role: string; showInactive: boolean };
}

export function EmployeesTable({ employees, total, page, pageSize, sites, departments, currentFilters }: Props) {
  const router = useRouter();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Local state for search input so typing feels instant (debounced URL push)
  const [searchValue, setSearchValue] = useState(currentFilters.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local search in sync if the server-driven filter changes (e.g. browser back)
  useEffect(() => { setSearchValue(currentFilters.q); }, [currentFilters.q]);

  const buildUrl = useCallback((overrides: Partial<typeof currentFilters & { page: number }>) => {
    const params = new URLSearchParams();
    const q            = overrides.q            ?? currentFilters.q;
    const site         = overrides.site         ?? currentFilters.site;
    const dept         = overrides.dept         ?? currentFilters.dept;
    const role         = overrides.role         ?? currentFilters.role;
    const showInactive = overrides.showInactive  ?? currentFilters.showInactive;
    const pg           = overrides.page          ?? 0;
    if (q)            params.set("q",       q);
    if (site)         params.set("site",    site);
    if (dept)         params.set("dept",    dept);
    if (role)         params.set("role",    role);
    if (showInactive) params.set("inactive", "1");
    if (pg)           params.set("page",    String(pg));
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

  const selectClass = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name, email, or code…"
          className="w-64 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
        />
        <select
          value={currentFilters.site}
          onChange={(e) => onFilterChange("site", e.target.value)}
          className={selectClass}
        >
          <option value="">All Sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={currentFilters.dept}
          onChange={(e) => onFilterChange("dept", e.target.value)}
          className={selectClass}
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={currentFilters.role}
          onChange={(e) => onFilterChange("role", e.target.value)}
          className={selectClass}
        >
          <option value="">All Roles</option>
          {Object.entries(ROLE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={currentFilters.showInactive}
            onChange={(e) => navigate({ showInactive: e.target.checked, page: 0 })}
            className="rounded"
          />
          Show inactive
        </label>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Name</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Code</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Role</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Department</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Hire Date</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  No employees match your search.
                </td>
              </tr>
            )}
            {employees.map((emp) => (
              <tr
                key={emp.id}
                onClick={() => router.push(`/admin/employees/${emp.id}`)}
                className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-white">
                  {emp.user.name}
                  {emp.user.email && (
                    <span className="ml-2 text-xs text-zinc-400">{emp.user.email}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                  {emp.employeeCode}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${emp.customRole ? "bg-indigo-100 text-indigo-700" : ROLE_BADGE[emp.role]}`}>
                    {emp.customRole ? emp.customRole.name : ROLE_LABEL[emp.role]}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {emp.department.name}
                  <span className="ml-1 text-zinc-400">· {emp.site.name}</span>
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {format(emp.hireDate, "MMM d, yyyy")}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    !emp.isActive
                      ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      : emp.onLeave
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  }`}>
                    {!emp.isActive ? "Inactive" : emp.onLeave ? "On Leave" : "Active"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>
          {total.toLocaleString()} {currentFilters.showInactive ? "" : "active "}employees
          {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate({ page: 0 })}
              disabled={page === 0}
              className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >«</button>
            <button
              onClick={() => navigate({ page: page - 1 })}
              disabled={page === 0}
              className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >‹ Prev</button>
            <button
              onClick={() => navigate({ page: page + 1 })}
              disabled={page >= totalPages - 1}
              className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >Next ›</button>
            <button
              onClick={() => navigate({ page: totalPages - 1 })}
              disabled={page >= totalPages - 1}
              className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >»</button>
          </div>
        )}
      </div>
    </>
  );
}
