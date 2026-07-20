"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { parseUtcDate } from "@/lib/utils/date";

type FilterValue = "all" | "current" | "open" | "ready" | "locked" | "ytd";

interface PayPeriodItem {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface Props {
  allPayPeriods: PayPeriodItem[];
  selectedId: string | undefined;
  currentFilter: FilterValue;
  siteId?: string;
  departmentId?: string;
}

export function PayPeriodsFilter({ allPayPeriods, selectedId, currentFilter, siteId, departmentId }: Props) {
  const router = useRouter();
  const calendarRef = useRef<HTMLDivElement>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const sorted = [...allPayPeriods].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  const currentYear = new Date().getFullYear();

  function applyFilter(value: FilterValue, id?: string | undefined) {
    const params = new URLSearchParams();
    if (id) params.set("id", id);
    if (value !== "all") params.set("filter", value);
    if (siteId) params.set("siteId", siteId);
    if (departmentId) params.set("departmentId", departmentId);
    router.push(`/payroll/pay-periods?${params.toString()}`);
  }

  // Filtered list used for prev/next navigation
  const filtered = sorted.filter((pp) => {
    if (currentFilter === "current") {
      const s = parseUtcDate(pp.startDate);
      const e = parseUtcDate(pp.endDate);
      return s <= todayMidnight && todayMidnight <= e;
    }
    if (currentFilter === "open") return pp.status === "OPEN";
    if (currentFilter === "ready") return pp.status === "READY";
    if (currentFilter === "locked") return pp.status === "LOCKED";
    if (currentFilter === "ytd") {
      return (
        parseUtcDate(pp.startDate).getFullYear() === currentYear ||
        parseUtcDate(pp.endDate).getFullYear() === currentYear
      );
    }
    return true;
  });

  const currentIndex = filtered.findIndex((pp) => pp.id === selectedId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < filtered.length - 1;

  const selectedPp = filtered[currentIndex] ?? sorted.find((pp) => pp.id === selectedId);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    if (showCalendar) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCalendar]);

  function handleCalendarSelect(d: Date) {
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
        // Find the pay period whose range contains this date range
        const match = sorted.find((pp) => {
          const s = parseUtcDate(pp.startDate);
          const e = parseUtcDate(pp.endDate);
          return s <= d && d <= e;
        });
        if (match) {
          applyFilter(currentFilter, match.id);
        }
        setShowCalendar(false);
      }
    }
  }

  return (
    <div className="relative shrink-0 space-y-1.5 border-b border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Filter dropdown */}
      <select
        value={currentFilter}
        onChange={(e) => applyFilter(e.target.value as FilterValue, selectedId)}
        className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      >
        <option value="all">All Pay Periods</option>
        <option value="current">Current Pay Period</option>
        <option value="ytd">Year to Date</option>
        <option value="open">Open</option>
        <option value="ready">Ready</option>
        <option value="locked">Locked</option>
      </select>

      {/* Prev / Next + date label + calendar */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={() => hasPrev && applyFilter(currentFilter, filtered[currentIndex - 1].id)}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          title="Previous pay period"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        <span className="flex-1 text-center text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
          {selectedPp
            ? `${format(parseUtcDate(selectedPp.startDate), "MMM d")} – ${format(parseUtcDate(selectedPp.endDate), "MMM d, yyyy")}`
            : "—"}
        </span>

        <button
          type="button"
          disabled={!hasNext}
          onClick={() => hasNext && applyFilter(currentFilter, filtered[currentIndex + 1].id)}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
          title="Next pay period"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        {/* Calendar picker */}
        <div className="relative" ref={calendarRef}>
          <button
            type="button"
            onClick={() => {
              if (!showCalendar) {
                setRangeStart(null);
                setRangeEnd(null);
                setHoverDate(null);
                setCalendarMonth(
                  selectedPp
                    ? parseUtcDate(selectedPp.startDate)
                    : new Date()
                );
              }
              setShowCalendar((v) => !v);
            }}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            title="Pick a pay period by date"
          >
            <Calendar className="h-3.5 w-3.5" />
          </button>

          {showCalendar && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
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
                    const isStart = rangeStart && isSameDay(d, rangeStart);
                    const isEnd = effectiveEnd && isSameDay(d, effectiveEnd);
                    const inRange =
                      rangeStart &&
                      effectiveEnd &&
                      d > rangeStart &&
                      d < effectiveEnd;
                    // Highlight if date falls inside a pay period that contains the selected period
                    const inSelected =
                      selectedPp &&
                      d >= parseUtcDate(selectedPp.startDate) &&
                      d <= parseUtcDate(selectedPp.endDate);

                    return (
                      <button
                        key={d.toISOString()}
                        type="button"
                        onClick={() => handleCalendarSelect(d)}
                        onMouseEnter={() => rangeStart && !rangeEnd && setHoverDate(d)}
                        onMouseLeave={() => setHoverDate(null)}
                        className={`rounded py-1 text-xs transition-colors
                          ${!inMonth ? "text-zinc-300 dark:text-zinc-600" : ""}
                          ${isStart || isEnd ? "bg-blue-600 font-semibold text-white" : ""}
                          ${inRange ? "bg-blue-100 dark:bg-blue-900/30" : ""}
                          ${inSelected && !isStart && !isEnd && !inRange ? "bg-zinc-100 dark:bg-zinc-700/50" : ""}
                          ${isToday(d) && !isStart && !isEnd ? "font-bold text-blue-600 dark:text-blue-400" : ""}
                          ${inMonth && !isStart && !isEnd ? "hover:bg-zinc-100 dark:hover:bg-zinc-700" : ""}
                        `}
                      >
                        {format(d, "d")}
                      </button>
                    );
                  });
                })()}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowCalendar(false)}
                  className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
