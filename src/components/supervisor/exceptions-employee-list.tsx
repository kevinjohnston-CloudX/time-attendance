"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

const EXCEPTION_LABEL: Record<string, string> = {
  MISSING_PUNCH:    "Missing Punch",
  LONG_SHIFT:       "Long Shift",
  SHORT_BREAK:      "Short Break",
  LATE_IN:          "Late In",
  EARLY_OUT:        "Early Out",
  MISSED_MEAL:      "Missed Meal",
  UNSCHEDULED_OT:   "Unscheduled OT",
  CONSECUTIVE_DAYS: "Consecutive Days",
  ABSENT:           "Absent",
};

const EXCEPTION_BADGE: Record<string, string> = {
  MISSING_PUNCH:    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  LONG_SHIFT:       "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  SHORT_BREAK:      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  MISSED_MEAL:      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  UNSCHEDULED_OT:   "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  CONSECUTIVE_DAYS: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  ABSENT:           "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  LATE_IN:          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  EARLY_OUT:        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

interface EmployeeEntry {
  employeeId: string;
  name: string;
  exceptionTypes: string[];
  count: number;
}

function buildUrl(siteId?: string, departmentId?: string, employeeId?: string, exceptionType?: string, payPeriodId?: string) {
  const params = new URLSearchParams();
  if (siteId) params.set("siteId", siteId);
  if (departmentId) params.set("departmentId", departmentId);
  if (employeeId) params.set("employeeId", employeeId);
  if (exceptionType) params.set("exceptionType", exceptionType);
  if (payPeriodId) params.set("payPeriodId", payPeriodId);
  const qs = params.toString();
  return `/supervisor/exceptions${qs ? `?${qs}` : ""}`;
}

interface Props {
  employees: EmployeeEntry[];
  totalCount: number;
  selectedEmployeeId?: string;
  siteId?: string;
  departmentId?: string;
  exceptionType?: string;
  payPeriodId?: string;
}

export function ExceptionsEmployeeList({
  employees,
  totalCount,
  selectedEmployeeId,
  siteId,
  departmentId,
  exceptionType,
  payPeriodId,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? employees.filter((e) =>
        e.name.toLowerCase().includes(search.toLowerCase())
      )
    : employees;

  return (
    <>
      {/* Search input */}
      <div className="shrink-0 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees…"
            className="w-full bg-transparent text-xs text-zinc-700 placeholder-zinc-400 outline-none dark:text-zinc-300"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {employees.length === 0 ? (
          <p className="p-4 text-center text-xs text-zinc-400">No exceptions</p>
        ) : (
          <>
            {/* "All" row — hide when searching */}
            {!search.trim() && (
              <Link
                href={buildUrl(siteId, departmentId, undefined, exceptionType, payPeriodId)}
                className={`flex w-full items-center justify-between border-b border-zinc-100 px-3 py-2.5 text-sm transition-colors dark:border-zinc-800/60 ${
                  !selectedEmployeeId
                    ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
                }`}
              >
                All employees
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {totalCount}
                </span>
              </Link>
            )}

            {filtered.length === 0 && (
              <p className="p-4 text-center text-xs text-zinc-400">No match</p>
            )}

            {filtered.map((emp) => {
              const isSelected = emp.employeeId === selectedEmployeeId;
              return (
                <Link
                  key={emp.employeeId}
                  href={buildUrl(siteId, departmentId, emp.employeeId, exceptionType, payPeriodId)}
                  className={`flex w-full flex-col border-b border-zinc-100 px-3 py-2.5 transition-colors dark:border-zinc-800/60 ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-950/30"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm font-medium ${isSelected ? "text-zinc-900 dark:text-white" : "text-zinc-700 dark:text-zinc-300"}`}>
                      {emp.name}
                    </p>
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {emp.count}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {emp.exceptionTypes.map((t) => (
                      <span
                        key={t}
                        className={`rounded px-1 py-0.5 text-xs ${EXCEPTION_BADGE[t] ?? "bg-zinc-100 text-zinc-500"}`}
                      >
                        {EXCEPTION_LABEL[t] ?? t}
                      </span>
                    ))}
                  </div>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
