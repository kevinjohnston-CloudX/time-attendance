"use client";

import { useState, useMemo } from "react";
import { minutesToHoursDecimal } from "@/lib/utils/duration";
import {
  TIMESHEET_STATUS_LABEL,
  type TimesheetStatusValue,
} from "@/lib/state-machines/labels";
import { Download, Search } from "lucide-react";

export type ReportRow = {
  employeeId: string;
  name: string;
  department: string;
  regMinutes: number;
  otMinutes: number;
  dtMinutes: number;
  ptoMinutes: number;
  totalMinutes: number;
  status: string;
};

interface Props {
  rows: ReportRow[];
  periodLabel: string;
}

export function HoursReportTable({ rows, periodLabel }: Props) {
  const [nameFilter, setNameFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.department))].sort(),
    [rows]
  );
  const statuses = useMemo(
    () => [...new Set(rows.map((r) => r.status))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (nameFilter && !r.name.toLowerCase().includes(nameFilter.toLowerCase()))
        return false;
      if (deptFilter && r.department !== deptFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, nameFilter, deptFilter, statusFilter]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.reg += r.regMinutes;
        acc.ot += r.otMinutes;
        acc.dt += r.dtMinutes;
        acc.pto += r.ptoMinutes;
        acc.total += r.totalMinutes;
        return acc;
      },
      { reg: 0, ot: 0, dt: 0, pto: 0, total: 0 }
    );
  }, [filtered]);

  function exportCsv() {
    const header = "Employee,Department,REG,OT,DT,PTO,Total,Status";
    const csvRows = filtered.map((r) => {
      const escapeName = r.name.includes(",") ? `"${r.name}"` : r.name;
      const escapeDept = r.department.includes(",")
        ? `"${r.department}"`
        : r.department;
      return [
        escapeName,
        escapeDept,
        minutesToHoursDecimal(r.regMinutes),
        minutesToHoursDecimal(r.otMinutes),
        minutesToHoursDecimal(r.dtMinutes),
        minutesToHoursDecimal(r.ptoMinutes),
        minutesToHoursDecimal(r.totalMinutes),
        r.status,
      ].join(",");
    });
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hours-report-${periodLabel.replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasFilters = nameFilter || deptFilter || statusFilter;

  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Hours Summary — {periodLabel}
        </h2>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
          {hasFilters && (
            <span className="text-zinc-400">({filtered.length} rows)</span>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Filter by name…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="w-48 rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
        </div>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {TIMESHEET_STATUS_LABEL[s as TimesheetStatusValue] ?? s}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => {
              setNameFilter("");
              setDeptFilter("");
              setStatusFilter("");
            }}
            className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">
                Employee
              </th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">
                Department
              </th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">
                REG
              </th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">
                OT
              </th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">
                DT
              </th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">
                PTO
              </th>
              <th className="px-4 py-3 text-right font-medium text-zinc-500">
                Total
              </th>
              <th className="px-4 py-3 text-left font-medium text-zinc-500">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-950">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-zinc-400"
                >
                  {rows.length === 0
                    ? "No timesheets for this pay period."
                    : "No employees match the current filters."}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr
                key={r.employeeId}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
              >
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-white">
                  {r.name}
                </td>
                <td className="px-4 py-3 text-zinc-500">{r.department}</td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                  {minutesToHoursDecimal(r.regMinutes)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    r.otMinutes > 0
                      ? "font-medium text-amber-600"
                      : "text-zinc-400"
                  }`}
                >
                  {minutesToHoursDecimal(r.otMinutes)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    r.dtMinutes > 0
                      ? "font-medium text-red-600"
                      : "text-zinc-400"
                  }`}
                >
                  {minutesToHoursDecimal(r.dtMinutes)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    r.ptoMinutes > 0
                      ? "font-medium text-purple-600 dark:text-purple-400"
                      : "text-zinc-400"
                  }`}
                >
                  {minutesToHoursDecimal(r.ptoMinutes)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                  {minutesToHoursDecimal(r.totalMinutes)}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-400">
                  {TIMESHEET_STATUS_LABEL[r.status as TimesheetStatusValue] ??
                    r.status}
                </td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <td
                  colSpan={2}
                  className="px-4 py-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300"
                >
                  Totals ({filtered.length} employee
                  {filtered.length !== 1 && "s"})
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-zinc-900 dark:text-white">
                  {minutesToHoursDecimal(totals.reg)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-600">
                  {minutesToHoursDecimal(totals.ot)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-600">
                  {minutesToHoursDecimal(totals.dt)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-purple-600 dark:text-purple-400">
                  {minutesToHoursDecimal(totals.pto)}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-zinc-900 dark:text-white">
                  {minutesToHoursDecimal(totals.total)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
