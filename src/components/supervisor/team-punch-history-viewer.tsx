"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  parseISO,
  addMonths,
  eachDayOfInterval,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameDay,
  isSameMonth,
} from "date-fns";
import { PUNCH_TYPE_LABEL, type PunchTypeValue } from "@/lib/state-machines/labels";
import { Search, Calendar, ChevronLeft, ChevronRight } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SiteItem = { id: string; name: string };
type DepartmentItem = { id: string; name: string };

type EmployeeListItem = {
  id: string;
  name: string;
  employeeCode: string;
  department: string;
};

type PunchItem = {
  id: string;
  punchTime: string;
  roundedTime: string;
  punchType: string;
  source: string;
  isApproved: boolean;
  correctedById: string | null;
  correctsId: string | null;
};

interface TeamPunchHistoryViewerProps {
  employees: EmployeeListItem[];
  selectedEmployeeId: string | null;
  punches: PunchItem[];
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  isPayroll: boolean;
  sites: SiteItem[];
  selectedSiteId: string | null;
  departments: DepartmentItem[];
  selectedDepartmentId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  WEB: "Web",
  KIOSK: "Kiosk",
  MOBILE: "Mobile",
  MANUAL: "Manual",
  SYSTEM: "System",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TeamPunchHistoryViewer({
  employees,
  selectedEmployeeId,
  punches,
  startDate,
  endDate,
  isPayroll,
  sites,
  selectedSiteId,
  departments,
  selectedDepartmentId,
}: TeamPunchHistoryViewerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  // Calendar picker state
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => new Date(startDate + "T12:00:00")
  );
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    if (showCalendar) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCalendar]);

  // Navigate preserving all current params; explicit null clears a param
  function go(
    sd: string = startDate,
    ed: string = endDate,
    eid: string | null = selectedEmployeeId,
    sid: string | null = selectedSiteId,
    did: string | null = selectedDepartmentId,
  ) {
    const p = new URLSearchParams();
    if (sd) p.set("startDate", sd);
    if (ed) p.set("endDate", ed);
    if (eid) p.set("employeeId", eid);
    if (sid) p.set("siteId", sid);
    if (did) p.set("departmentId", did);
    router.push(`/supervisor/punch-history?${p.toString()}`);
  }

  function handleCalendarDateSelect(d: Date) {
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(d);
      setRangeEnd(null);
      setHoverDate(null);
    } else {
      if (d < rangeStart) {
        setRangeStart(d);
        setRangeEnd(null);
      } else {
        setRangeEnd(d);
        go(format(rangeStart, "yyyy-MM-dd"), format(d, "yyyy-MM-dd"));
        setShowCalendar(false);
      }
    }
  }

  const filteredEmployees = employees.filter((emp) => {
    const q = search.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.employeeCode.toLowerCase().includes(q) ||
      emp.department.toLowerCase().includes(q)
    );
  });

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) ?? null;
  const displayStart = new Date(startDate + "T12:00:00");
  const displayEnd = new Date(endDate + "T12:00:00");

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">

        {/* Calendar date range picker */}
        <div className="relative flex items-center gap-2" ref={calendarRef}>
          <button
            type="button"
            onClick={() => {
              if (!showCalendar) {
                setRangeStart(new Date(startDate + "T12:00:00"));
                setRangeEnd(new Date(endDate + "T12:00:00"));
                setHoverDate(null);
                setCalendarMonth(new Date(startDate + "T12:00:00"));
              }
              setShowCalendar((v) => !v);
            }}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Pick a date range"
          >
            <Calendar className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
            {format(displayStart, "MM/dd/yyyy")} – {format(displayEnd, "MM/dd/yyyy")}
          </span>

          {showCalendar && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              {/* Month navigation */}
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCalendarMonth((m) => addMonths(m, -1))}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {format(calendarMonth, "MMMM yyyy")}
                </span>
                <button
                  type="button"
                  onClick={() => setCalendarMonth((m) => addMonths(m, 1))}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-0">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} className="py-1 text-center text-xs font-medium text-zinc-400">
                    {d}
                  </div>
                ))}
                {(() => {
                  const calDays = eachDayOfInterval({
                    start: startOfWeek(startOfMonth(calendarMonth)),
                    end: endOfWeek(endOfMonth(calendarMonth)),
                  });
                  const effectiveEnd = rangeEnd ?? hoverDate;
                  return calDays.map((d) => {
                    const inMonth = isSameMonth(d, calendarMonth);
                    const isNow = isSameDay(d, new Date());
                    const isStart = !!rangeStart && isSameDay(d, rangeStart);
                    const isEnd = !!rangeEnd && isSameDay(d, rangeEnd);
                    const isEndpoint = isStart || isEnd;
                    const inRange =
                      !!rangeStart && !!effectiveEnd && d > rangeStart && d < effectiveEnd;
                    return (
                      <button
                        key={d.toISOString()}
                        type="button"
                        onClick={() => handleCalendarDateSelect(d)}
                        onMouseEnter={() => rangeStart && !rangeEnd && setHoverDate(d)}
                        onMouseLeave={() => rangeStart && !rangeEnd && setHoverDate(null)}
                        className={`h-7 w-7 rounded text-xs transition-colors ${
                          isEndpoint
                            ? "bg-blue-600 font-semibold text-white"
                            : inRange
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            : !inMonth
                            ? "text-zinc-300 dark:text-zinc-600"
                            : "text-zinc-700 dark:text-zinc-300"
                        } ${isNow && !isEndpoint && !inRange ? "ring-1 ring-blue-400" : ""} ${
                          !isEndpoint ? "hover:bg-zinc-100 dark:hover:bg-zinc-700" : ""
                        }`}
                      >
                        {d.getDate()}
                      </button>
                    );
                  });
                })()}
              </div>

              {/* Footer */}
              <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2 dark:border-zinc-700">
                <span className="text-xs text-zinc-400">
                  {rangeStart && !rangeEnd ? "Select end date" : "Select start date"}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setRangeStart(null);
                      setRangeEnd(null);
                      setHoverDate(null);
                    }}
                    className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCalendar(false)}
                    className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Today button */}
        <button
          type="button"
          onClick={() => {
            const today = format(new Date(), "yyyy-MM-dd");
            go(today, today);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Today
        </button>

        {/* Site filter — payroll+ only */}
        {isPayroll && sites.length > 0 && (
          <select
            value={selectedSiteId ?? ""}
            onChange={(e) => go(startDate, endDate, null, e.target.value || null, null)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">All Sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        )}

        {/* Department filter — payroll+ only */}
        {isPayroll && (
          <select
            value={selectedDepartmentId ?? ""}
            onChange={(e) => go(startDate, endDate, null, selectedSiteId, e.target.value || null)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="">All Departments</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        )}

        <span className="ml-auto text-xs text-zinc-400">
          {employees.length} employee{employees.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Split pane ────────────────────────────────────────────────────── */}
      <div className="grid h-[calc(100vh-14rem)] grid-cols-[260px_1fr]">

        {/* ── Left: employee list ──────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
          <div className="border-b border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search employees…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-950">
            {filteredEmployees.length === 0 && (
              <p className="p-4 text-center text-sm text-zinc-400">No employees found.</p>
            )}
            {filteredEmployees.map((emp) => {
              const isSelected = emp.id === selectedEmployeeId;
              return (
                <button
                  key={emp.id}
                  onClick={() => go(startDate, endDate, emp.id)}
                  className={`flex w-full flex-col items-start border-b border-zinc-100 px-3 py-2.5 text-left transition-colors dark:border-zinc-800/60 ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-950/30"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <p
                    className={`truncate text-sm font-semibold ${
                      isSelected ? "text-zinc-900 dark:text-white" : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {emp.name}
                  </p>
                  <p className="truncate text-xs text-zinc-400">
                    {emp.employeeCode} · {emp.department}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: punch detail ──────────────────────────────────────────── */}
        <div className="overflow-y-auto bg-white dark:bg-zinc-950">
          {!selectedEmployee ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-zinc-400">
                Select an employee to view their punch history.
              </p>
            </div>
          ) : (
            <div className="p-5">
              <div className="mb-4 border-b border-zinc-200 pb-3 dark:border-zinc-800">
                <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                  {selectedEmployee.name}
                </h2>
                <p className="text-xs text-zinc-500">
                  {selectedEmployee.employeeCode} · {selectedEmployee.department}
                </p>
              </div>

              {punches.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">
                  No punches for this date range.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-[#2492c7] dark:border-zinc-700">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">
                          Date
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">
                          Time
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">
                          Rounded
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">
                          Type
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">
                          Source
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-white">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {punches.map((punch) => {
                        const isSuperseded = !!punch.correctedById;
                        const isCorrection = !!punch.correctsId;
                        return (
                          <tr
                            key={punch.id}
                            className={
                              isSuperseded
                                ? "bg-zinc-50/50 opacity-50 dark:bg-zinc-900/20"
                                : "bg-white dark:bg-zinc-900"
                            }
                          >
                            <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                              {format(parseISO(punch.punchTime), "MMM d")}
                            </td>
                            <td
                              className={`px-4 py-3 font-mono ${
                                isSuperseded
                                  ? "text-zinc-400 line-through"
                                  : "text-zinc-700 dark:text-zinc-300"
                              }`}
                            >
                              {format(parseISO(punch.punchTime), "h:mm:ss a")}
                            </td>
                            <td className="px-4 py-3 font-mono text-zinc-700 dark:text-zinc-300">
                              {format(parseISO(punch.roundedTime), "h:mm a")}
                            </td>
                            <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                              <span className="inline-flex items-center gap-1">
                                {PUNCH_TYPE_LABEL[punch.punchType as PunchTypeValue] ??
                                  punch.punchType}
                                {isCorrection && (
                                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                    correction
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-zinc-500">
                              {SOURCE_LABEL[punch.source] ?? punch.source}
                            </td>
                            <td className="px-4 py-3">
                              {isSuperseded ? (
                                <span className="text-xs text-zinc-400">superseded</span>
                              ) : punch.isApproved ? (
                                <span className="text-xs text-green-600 dark:text-green-400">
                                  approved
                                </span>
                              ) : (
                                <span className="text-xs text-amber-600 dark:text-amber-400">
                                  pending
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
