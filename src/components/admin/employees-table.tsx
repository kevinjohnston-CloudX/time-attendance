"use client";

import { useState } from "react";
import Link from "next/link";
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
  hireDate: Date;
  user: { name: string | null; email: string | null };
  site: { name: string };
  department: { name: string };
  customRole: { id: string; name: string } | null;
}

export function EmployeesTable({ employees }: { employees: Employee[] }) {
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const sites = Array.from(new Set(employees.map((e) => e.site.name))).sort();
  const departments = Array.from(
    new Set(
      employees
        .filter((e) => !siteFilter || e.site.name === siteFilter)
        .map((e) => e.department.name)
    )
  ).sort();

  const q = query.toLowerCase().trim();
  const filtered = employees.filter((emp) => {
    if (siteFilter && emp.site.name !== siteFilter) return false;
    if (deptFilter && emp.department.name !== deptFilter) return false;
    if (roleFilter && emp.role !== roleFilter) return false;
    if (q) {
      return (
        (emp.user.name?.toLowerCase().includes(q)) ||
        (emp.user.email?.toLowerCase().includes(q)) ||
        emp.employeeCode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const isFiltered = !!q || !!siteFilter || !!deptFilter || !!roleFilter;

  const selectClass = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or code…"
          className="w-64 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
        />
        <select
          value={siteFilter}
          onChange={(e) => { setSiteFilter(e.target.value); setDeptFilter(""); }}
          className={selectClass}
        >
          <option value="">All Sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">All Roles</option>
          {Object.entries(ROLE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
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
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-400">
                  {q ? "No employees match your search." : "No employees yet."}
                </td>
              </tr>
            )}
            {filtered.map((emp) => (
              <tr key={emp.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
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
                    emp.isActive
                      ? "bg-green-100 text-green-700"
                      : "bg-zinc-100 text-zinc-500"
                  }`}>
                    {emp.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/employees/${emp.id}`}
                    className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isFiltered && (
        <p className="mt-2 text-xs text-zinc-400">
          Showing {filtered.length} of {employees.length} employees
        </p>
      )}
    </>
  );
}
