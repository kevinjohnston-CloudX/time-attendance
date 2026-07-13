"use client";

import { useState } from "react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, format,
  addMonths, subMonths, isWithinInterval, startOfDay, endOfDay,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STATUS_CELL: Record<string, string> = {
  APPROVED:  "bg-green-200 text-green-900 dark:bg-green-900/50 dark:text-green-200",
  POSTED:    "bg-emerald-200 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200",
  PENDING:   "bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  DRAFT:     "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  REJECTED:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  CANCELLED: "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600",
};

const STATUS_DOT: Record<string, string> = {
  APPROVED:  "bg-green-500",
  POSTED:    "bg-emerald-500",
  PENDING:   "bg-amber-500",
  DRAFT:     "bg-zinc-400",
  REJECTED:  "bg-red-400",
  CANCELLED: "bg-zinc-300",
};

const STATUS_PRIORITY: Record<string, number> = {
  APPROVED: 1, POSTED: 2, PENDING: 3, DRAFT: 4, REJECTED: 5, CANCELLED: 6,
};

type LeaveRequest = {
  id: string;
  status: string;
  startDate: string | Date;
  endDate: string | Date;
  leaveType: { name: string };
  durationMinutes: number;
};

export function LeaveCalendar({ requests, className }: { requests: LeaveRequest[]; className?: string }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth)),
    end:   endOfWeek(endOfMonth(currentMonth)),
  });

  const weekCount = days.length / 7;

  function getStatusForDay(day: Date): string | null {
    const matching = requests.filter((req) => {
      const s = startOfDay(new Date(req.startDate));
      const e = endOfDay(new Date(req.endDate));
      return isWithinInterval(day, { start: s, end: e });
    });
    if (matching.length === 0) return null;
    return matching.sort(
      (a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
    )[0].status;
  }

  return (
    <div className={`flex flex-col rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900${className ? ` ${className}` : ""}`}>
      {/* Month navigation */}
      <div className="mb-4 flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-[9rem] text-center text-sm font-semibold text-zinc-900 dark:text-white">
          {format(currentMonth, "MMMM yyyy")}
        </p>
        <button
          type="button"
          onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="mb-2 grid shrink-0 grid-cols-7 rounded-lg bg-zinc-800 dark:bg-zinc-600">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
          <div
            key={d}
            className={`py-2 text-center text-xs font-semibold tracking-wide uppercase ${
              i === 0 || i === 6
                ? "text-zinc-400 dark:text-zinc-300"
                : "text-zinc-100 dark:text-white"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells — grows to fill remaining height */}
      <div
        className="flex-1 grid grid-cols-7 gap-1"
        style={{ gridTemplateRows: `repeat(${weekCount}, 1fr)` }}
      >
        {days.map((day) => {
          const status  = getStatusForDay(day);
          const inMonth = isSameMonth(day, currentMonth);
          const today   = isToday(day);

          return (
            <div
              key={day.toISOString()}
              className={[
                "flex items-center justify-center rounded-lg text-xs font-medium transition-colors border",
                inMonth ? "" : "opacity-30",
                status && inMonth
                  ? `${STATUS_CELL[status]} border-transparent`
                  : "border-zinc-400 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300",
              ].join(" ")}
            >
              {today ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 font-bold text-white">
                  {format(day, "d")}
                </span>
              ) : (
                format(day, "d")
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {[
          { status: "APPROVED", label: "Approved" },
          { status: "PENDING",  label: "Pending" },
          { status: "POSTED",   label: "Posted" },
          { status: "REJECTED", label: "Rejected" },
        ].map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATUS_DOT[status]}`} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
