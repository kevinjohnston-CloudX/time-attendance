"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

type EmployeeRow = {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
  siteId: string;
  site: string;
  payCategory: string | null;
  hireDate: string | null;
};

type SiteOption = { id: string; name: string };

export function AccrualsEmployeeList({
  employees,
  sites,
}: {
  employees: EmployeeRow[];
  sites: SiteOption[];
}) {
  const [query, setQuery] = useState("");
  const [siteId, setSiteId] = useState("");

  const q = query.toLowerCase().trim();
  const filtered = employees.filter((e) => {
    if (siteId && e.siteId !== siteId) return false;
    if (q) {
      return (
        e.name.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, code, or department…"
          className="w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />
        {sites.length > 1 && (
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-zinc-400">No employees found.</p>
        )}
        {filtered.map((emp) => (
          <Link
            key={emp.id}
            href={`/admin/accruals/${emp.id}`}
            className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          >
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-white">{emp.name}</p>
              <p className="text-xs text-zinc-500">
                {emp.employeeCode} · {emp.site} · {emp.department}
                {emp.payCategory ? ` · ${emp.payCategory}` : ""}
                {emp.hireDate ? ` · Hired ${emp.hireDate}` : ""}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
          </Link>
        ))}
      </div>
    </>
  );
}
