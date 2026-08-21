"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

type EmployeeRow = {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
  payCategory: string | null;
  hireDate: string | null;
};

export function AccrualsEmployeeList({ employees }: { employees: EmployeeRow[] }) {
  const [query, setQuery] = useState("");

  const q = query.toLowerCase().trim();
  const filtered = q
    ? employees.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
      )
    : employees;

  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, code, or department…"
        className="mt-4 w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      />

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
                {emp.employeeCode} · {emp.department}
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
