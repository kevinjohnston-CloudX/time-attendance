"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, CalendarCheck } from "lucide-react";
import { parseUtcDate } from "@/lib/utils/date";

type FilterValue = "all" | "current" | "ytd";
type StatusFilter = "all" | "open" | "ready" | "locked";

interface PayPeriodItem {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  ruleSetId?: string | null;
  ruleSetName?: string | null;
  ruleSetFrequency?: string | null;
}

interface Props {
  allPayPeriods: PayPeriodItem[];
  selectedId: string | undefined;
  currentFilter: FilterValue;
  statusFilter: StatusFilter;
  monthParam?: string; // "YYYY-MM" — set when browsing by month
  siteId?: string;
  departmentId?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PayPeriodsFilter({
  allPayPeriods,
  selectedId,
  currentFilter,
  statusFilter,
  monthParam,
  siteId,
  departmentId,
}: Props) {
  const router = useRouter();
  const pickerRef = useRef<HTMLDivElement>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() =>
    monthParam ? parseInt(monthParam.slice(0, 4)) : new Date().getFullYear()
  );

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const sorted = [...allPayPeriods].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  const currentYear = new Date().getFullYear();

  // All unique "YYYY-MM" values that have at least one pay period
  const allMonthKeys = [
    ...new Set(
      sorted.flatMap((pp) => {
        const keys: string[] = [];
        const s = parseUtcDate(pp.startDate);
        const e = parseUtcDate(pp.endDate);
        // Include all months the period overlaps
        const cur = new Date(s.getFullYear(), s.getMonth(), 1);
        const end = new Date(e.getFullYear(), e.getMonth(), 1);
        while (cur <= end) {
          keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
          cur.setMonth(cur.getMonth() + 1);
        }
        return keys;
      })
    ),
  ].sort();

  function applyFilter(scope: FilterValue, id?: string, newStatus?: StatusFilter) {
    const params = new URLSearchParams();
    if (id) params.set("id", id);
    if (scope !== "all") params.set("filter", scope);
    const resolvedStatus = newStatus ?? statusFilter;
    if (resolvedStatus !== "all") params.set("status", resolvedStatus);
    // clear month when changing scope filter
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    router.push(`/payroll/pay-periods?${params.toString()}`);
  }

  function jumpToCurrent() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      return s <= today && today <= e;
    });
    if (current) applyFilter("current", current.id, "all");
  }

  const isOnCurrentPeriod = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const current = sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      return s <= today && today <= e;
    });
    return current?.id === selectedId && currentFilter === "current" && statusFilter === "all" && !monthParam;
  })();

  // Find the first pay period overlapping a given month
  function findPayPeriodForMonth(year: number, month: number): PayPeriodItem | undefined {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const startsInMonth = sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      return s.getFullYear() === year && s.getMonth() === month;
    });
    if (startsInMonth) return startsInMonth;
    return sorted.find((pp) => {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      return s <= monthEnd && e >= monthStart;
    });
  }

  function handleMonthSelect(month: number) {
    const key = `${pickerYear}-${String(month + 1).padStart(2, "0")}`;
    const match = findPayPeriodForMonth(pickerYear, month);
    const params = new URLSearchParams();
    params.set("month", key);
    if (match) params.set("id", match.id);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    router.push(`/payroll/pay-periods?${params.toString()}`);
    setShowPicker(false);
  }

  // Month-mode prev/next: navigate to adjacent month key
  const monthModeIndex = monthParam ? allMonthKeys.indexOf(monthParam) : -1;
  const inMonthMode = monthParam != null && monthModeIndex >= 0;
  const hasPrevMonth = inMonthMode && monthModeIndex > 0;
  const hasNextMonth = inMonthMode && monthModeIndex < allMonthKeys.length - 1;

  function navigateMonth(delta: -1 | 1) {
    const newKey = allMonthKeys[monthModeIndex + delta];
    if (!newKey) return;
    const [y, m] = newKey.split("-").map(Number);
    const match = findPayPeriodForMonth(y, m - 1);
    const params = new URLSearchParams();
    params.set("month", newKey);
    if (match) params.set("id", match.id);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    router.push(`/payroll/pay-periods?${params.toString()}`);
  }

  // Pay-period-mode prev/next (when not in month mode)
  const filtered = inMonthMode ? [] : sorted.filter((pp) => {
    if (currentFilter === "current") {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      if (!(s <= todayMidnight && todayMidnight <= e)) return false;
    } else if (currentFilter === "ytd") {
      if (
        parseUtcDate(pp.startDate).getFullYear() !== currentYear &&
        parseUtcDate(pp.endDate).getFullYear() !== currentYear
      ) return false;
    }
    if (statusFilter === "open") return pp.status === "OPEN";
    if (statusFilter === "ready") return pp.status === "READY";
    if (statusFilter === "locked") return pp.status === "LOCKED";
    return true;
  });

  const currentIndex = filtered.findIndex((pp) => pp.id === selectedId);
  const hasPrev = inMonthMode ? hasPrevMonth : currentIndex > 0;
  const hasNext = inMonthMode ? hasNextMonth : currentIndex < filtered.length - 1;

  const selectedPp = sorted.find((pp) => pp.id === selectedId);

  // Label: show "Month YYYY" in month mode, date range otherwise
  const label = (() => {
    if (inMonthMode && monthParam) {
      const [y, m] = monthParam.split("-").map(Number);
      return format(new Date(y, m - 1, 1), "MMMM yyyy");
    }
    if (selectedPp) {
      return `${format(parseUtcDate(selectedPp.startDate), "MMM d")} – ${format(addDays(parseUtcDate(selectedPp.endDate), -1), "MMM d, yyyy")}`;
    }
    return "—";
  })();

  // Which months in the picker year have any pay period
  const monthsWithPeriods = new Set(
    allMonthKeys
      .filter((k) => k.startsWith(`${pickerYear}-`))
      .map((k) => parseInt(k.slice(5, 7)) - 1)
  );

  const selectedMonthIdx = monthParam
    ? parseInt(monthParam.slice(5, 7)) - 1
    : -1;
  const selectedMonthYear = monthParam ? parseInt(monthParam.slice(0, 4)) : -1;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPicker]);

  return (
    <div className="relative shrink-0 space-y-1.5 border-b border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Scope + Status filters + Today button */}
      <div className="flex items-center gap-1.5">
        <select
          value={currentFilter}
          onChange={(e) => applyFilter(e.target.value as FilterValue, selectedId)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="all">All</option>
          <option value="current">Current</option>
          <option value="ytd">Year to Date</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => applyFilter(currentFilter, selectedId, e.target.value as StatusFilter)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="ready">Ready</option>
          <option value="locked">Locked</option>
        </select>
        <button
          type="button"
          onClick={jumpToCurrent}
          disabled={isOnCurrentPeriod}
          title="Jump to current pay period"
          className="shrink-0 rounded-lg border border-zinc-300 bg-white p-1 text-zinc-500 hover:border-blue-400 hover:text-blue-600 disabled:cursor-default disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
        >
          <CalendarCheck className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Prev / Next + label + month/year picker */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={() => {
            if (inMonthMode) navigateMonth(-1);
            else if (currentIndex > 0) applyFilter(currentFilter, filtered[currentIndex - 1].id);
          }}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          title={inMonthMode ? "Previous month" : "Previous pay period"}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        <span className="flex-1 text-center text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
          {label}
        </span>

        <button
          type="button"
          disabled={!hasNext}
          onClick={() => {
            if (inMonthMode) navigateMonth(1);
            else if (currentIndex < filtered.length - 1) applyFilter(currentFilter, filtered[currentIndex + 1].id);
          }}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          title={inMonthMode ? "Next month" : "Next pay period"}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        {/* Month/year picker */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => {
              if (!showPicker) {
                setPickerYear(
                  monthParam
                    ? parseInt(monthParam.slice(0, 4))
                    : selectedPp
                      ? parseUtcDate(selectedPp.startDate).getFullYear()
                      : new Date().getFullYear()
                );
              }
              setShowPicker((v) => !v);
            }}
            className={`rounded p-1 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200 ${
              inMonthMode
                ? "text-blue-600 dark:text-blue-400"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
            title="Jump to month"
          >
            <Calendar className="h-3.5 w-3.5" />
          </button>

          {showPicker && (
            <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
              {/* Year navigation */}
              <div className="mb-2.5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {pickerYear}
                </span>
                <button
                  type="button"
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Month grid */}
              <div className="grid grid-cols-4 gap-1">
                {MONTHS.map((label, idx) => {
                  const hasPeriod = monthsWithPeriods.has(idx);
                  const isSelected = pickerYear === selectedMonthYear && idx === selectedMonthIdx;
                  const isCurrentMonth =
                    pickerYear === new Date().getFullYear() && idx === new Date().getMonth();
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={!hasPeriod}
                      onClick={() => handleMonthSelect(idx)}
                      className={`rounded py-1.5 text-xs font-medium transition-colors
                        ${isSelected
                          ? "bg-blue-600 text-white"
                          : isCurrentMonth && hasPeriod
                            ? "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:hover:bg-blue-950/50"
                            : hasPeriod
                              ? "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                              : "cursor-default text-zinc-300 dark:text-zinc-600"
                        }
                      `}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
