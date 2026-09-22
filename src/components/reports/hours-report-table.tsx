"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { minutesToHoursDecimal } from "@/lib/utils/duration";
import {
  TIMESHEET_STATUS_LABEL,
  type TimesheetStatusValue,
} from "@/lib/state-machines/labels";
import { Download, Search, Columns3 } from "lucide-react";
import { Table, THead, TBody, TFoot, TR, TH, TD } from "@/components/ui";

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

type ColumnKey =
  | "employee"
  | "department"
  | "reg"
  | "ot"
  | "dt"
  | "pto"
  | "total"
  | "status";

const COLUMNS: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: "employee", label: "Employee", defaultVisible: true },
  { key: "department", label: "Department", defaultVisible: true },
  { key: "reg", label: "REG", defaultVisible: true },
  { key: "ot", label: "OT", defaultVisible: true },
  { key: "dt", label: "DT", defaultVisible: true },
  { key: "pto", label: "PTO", defaultVisible: true },
  { key: "total", label: "Total", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
];

const DEFAULT_VISIBLE = new Set<ColumnKey>(
  COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)
);

interface Props {
  rows: ReportRow[];
  periodLabel: string;
}

export function HoursReportTable({ rows, periodLabel }: Props) {
  const [nameFilter, setNameFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    () => new Set(DEFAULT_VISIBLE)
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);

  // Close column menu on outside click
  useEffect(() => {
    if (!colMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setColMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [colMenuOpen]);

  function toggleColumn(key: ColumnKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Don't allow hiding all columns — keep at least one
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const show = (key: ColumnKey) => visibleCols.has(key);

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

  const visibleColCount = visibleCols.size;

  // Count visible "left" text columns (employee + department) for totals colspan
  const totalsColspan =
    (show("employee") ? 1 : 0) + (show("department") ? 1 : 0) || 1;

  function exportCsv() {
    const headerParts: string[] = [];
    if (show("employee")) headerParts.push("Employee");
    if (show("department")) headerParts.push("Department");
    if (show("reg")) headerParts.push("REG");
    if (show("ot")) headerParts.push("OT");
    if (show("dt")) headerParts.push("DT");
    if (show("pto")) headerParts.push("PTO");
    if (show("total")) headerParts.push("Total");
    if (show("status")) headerParts.push("Status");

    const csvRows = filtered.map((r) => {
      const parts: string[] = [];
      if (show("employee"))
        parts.push(r.name.includes(",") ? `"${r.name}"` : r.name);
      if (show("department"))
        parts.push(
          r.department.includes(",") ? `"${r.department}"` : r.department
        );
      if (show("reg")) parts.push(minutesToHoursDecimal(r.regMinutes));
      if (show("ot")) parts.push(minutesToHoursDecimal(r.otMinutes));
      if (show("dt")) parts.push(minutesToHoursDecimal(r.dtMinutes));
      if (show("pto")) parts.push(minutesToHoursDecimal(r.ptoMinutes));
      if (show("total")) parts.push(minutesToHoursDecimal(r.totalMinutes));
      if (show("status")) parts.push(r.status);
      return parts.join(",");
    });

    const csv = [headerParts.join(","), ...csvRows].join("\n");
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
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          Hours Summary — {periodLabel}
        </h2>
        <div className="flex items-center gap-3">
          {/* Column visibility toggle */}
          <div className="relative" ref={colMenuRef}>
            <button
              onClick={() => setColMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <Columns3 className="h-3.5 w-3.5" />
              Columns
            </button>
            {colMenuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg ta-modal py-1">
                {COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.has(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="rounded border-[var(--stroke-default)]"
                    />
                    <span className="text-[var(--text-secondary)]">
                      {col.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

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
      <div
        className="mt-3"
        style={{ borderRadius: "var(--radius-l)", overflow: "hidden", boxShadow: "var(--shadow-card)" }}
      >
        <Table>
          <THead>
            <TR>
              {show("employee") && <TH>Employee</TH>}
              {show("department") && <TH>Department</TH>}
              {show("reg") && <TH numeric>REG</TH>}
              {show("ot") && <TH numeric>OT</TH>}
              {show("dt") && <TH numeric>DT</TH>}
              {show("pto") && <TH numeric>PTO</TH>}
              {show("total") && <TH numeric>Total</TH>}
              {show("status") && <TH>Status</TH>}
            </TR>
          </THead>
          <TBody>
            {filtered.length === 0 && (
              <TR>
                <TD colSpan={visibleColCount} align="center" style={{ color: "var(--text-tertiary)", height: 72 }}>
                  {/* Which of the two it is. "No timesheets" while a filter is
                      set reads as a clean period when it is not one. */}
                  {rows.length === 0
                    ? "No timesheets for this pay period."
                    : "No employees match the current filters."}
                </TD>
              </TR>
            )}
            {filtered.map((r) => (
              <TR key={r.employeeId}>
                {show("employee") && <TD style={{ fontWeight: "var(--weight-medium)" }}>{r.name}</TD>}
                {show("department") && <TD style={{ color: "var(--text-secondary)" }}>{r.department}</TD>}
                {show("reg") && <TD numeric style={{ color: "var(--text-secondary)" }}>{minutesToHoursDecimal(r.regMinutes)}</TD>}

                {/* Zero is dimmed and anything above it is coloured, so a
                    period's overtime and doubletime can be found by scanning
                    the column rather than reading every figure. */}
                {show("ot") && (
                  <TD
                    numeric
                    style={
                      r.otMinutes > 0
                        ? { color: "var(--text-warning)", fontWeight: "var(--weight-medium)" }
                        : { color: "var(--text-tertiary)" }
                    }
                  >
                    {minutesToHoursDecimal(r.otMinutes)}
                  </TD>
                )}
                {show("dt") && (
                  <TD
                    numeric
                    style={
                      r.dtMinutes > 0
                        ? { color: "var(--text-error)", fontWeight: "var(--weight-medium)" }
                        : { color: "var(--text-tertiary)" }
                    }
                  >
                    {minutesToHoursDecimal(r.dtMinutes)}
                  </TD>
                )}
                {show("pto") && (
                  <TD
                    numeric
                    style={
                      r.ptoMinutes > 0
                        ? { color: "var(--wms-color-violet-600)", fontWeight: "var(--weight-medium)" }
                        : { color: "var(--text-tertiary)" }
                    }
                  >
                    {minutesToHoursDecimal(r.ptoMinutes)}
                  </TD>
                )}
                {show("total") && (
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)" }}>
                    {minutesToHoursDecimal(r.totalMinutes)}
                  </TD>
                )}
                {show("status") && (
                  <TD style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                    {TIMESHEET_STATUS_LABEL[r.status as TimesheetStatusValue] ?? r.status}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>

          {filtered.length > 0 && (
            <TFoot>
              <TR>
                <TD colSpan={totalsColspan} style={{ fontWeight: "var(--weight-semibold)", borderBottom: "none" }}>
                  Totals ({filtered.length} employee{filtered.length !== 1 && "s"})
                </TD>
                {show("reg") && (
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)", borderBottom: "none" }}>
                    {minutesToHoursDecimal(totals.reg)}
                  </TD>
                )}
                {show("ot") && (
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-warning)", borderBottom: "none" }}>
                    {minutesToHoursDecimal(totals.ot)}
                  </TD>
                )}
                {show("dt") && (
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-error)", borderBottom: "none" }}>
                    {minutesToHoursDecimal(totals.dt)}
                  </TD>
                )}
                {show("pto") && (
                  <TD numeric style={{ fontWeight: "var(--weight-semibold)", color: "var(--wms-color-violet-600)", borderBottom: "none" }}>
                    {minutesToHoursDecimal(totals.pto)}
                  </TD>
                )}
                {show("total") && (
                  <TD numeric style={{ fontWeight: "var(--weight-bold)", borderBottom: "none" }}>
                    {minutesToHoursDecimal(totals.total)}
                  </TD>
                )}
                {show("status") && <TD style={{ borderBottom: "none" }} />}
              </TR>
            </TFoot>
          )}
        </Table>
      </div>
    </>
  );
}
