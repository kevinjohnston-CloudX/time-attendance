"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  format,
  startOfMonth,
  getDaysInMonth,
  getDay,
  addMonths,
  subMonths,
  parseISO,
  isBefore,
  startOfToday,
} from "date-fns";

export type DaySelection =
  | { date: string; type: "FULL" }
  | { date: string; type: "PARTIAL"; leaveFrom: string; leaveTo: string };

export interface ShiftInfo {
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  workDays: number[]; // 0=Sun … 6=Sat
  mealBreakMinutes?: number | null;
  mealBreakAfterMinutes?: number | null;
}

interface Props {
  value: DaySelection[];
  onChange: (days: DaySelection[]) => void;
  shift: ShiftInfo | null;
}

const DAY_HEADERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function calcDayMinutes(shift: ShiftInfo | null, day: DaySelection): number {
  const start          = shift ? timeToMins(shift.startTime) : 9 * 60;
  const end            = shift ? timeToMins(shift.endTime)   : 17 * 60;
  const mealMins       = shift?.mealBreakMinutes   ?? 0;
  const mealAfter      = shift?.mealBreakAfterMinutes ?? 300;
  const mealStart      = start + mealAfter;
  const mealEnd        = mealStart + mealMins;

  if (day.type === "FULL") return (end - start) - mealMins;

  const leaveFrom      = timeToMins(day.leaveFrom);
  const leaveTo        = timeToMins(day.leaveTo);
  const raw            = Math.max(0, leaveTo - leaveFrom);
  const overlapStart   = Math.max(leaveFrom, mealStart);
  const overlapEnd     = Math.min(leaveTo, mealEnd);
  const overlap        = Math.max(0, overlapEnd - overlapStart);
  return Math.max(0, raw - overlap);
}

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmt12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

export function LeaveDayPicker({ value, onChange, shift }: Props) {
  const today = startOfToday();
  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(today));

  const workDays = shift?.workDays ?? DEFAULT_WORK_DAYS;
  const selMap = new Map(value.map((d) => [d.date, d]));

  const firstOfMonth = startOfMonth(displayMonth);
  const totalDays = getDaysInMonth(displayMonth);
  const startOffset = getDay(firstOfMonth);

  // Build calendar grid: null = empty leading cell
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  function dateStr(day: number): string {
    return format(
      new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day),
      "yyyy-MM-dd"
    );
  }

  function toggleDay(day: number) {
    const ds = dateStr(day);
    const date = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
    if (isBefore(date, today)) return;
    if (!workDays.includes(getDay(date))) return;

    if (selMap.has(ds)) {
      onChange(value.filter((d) => d.date !== ds));
    } else {
      onChange([...value, { date: ds, type: "FULL" }]);
    }
  }

  function setFull(ds: string) {
    onChange(value.map((d) => (d.date === ds ? { date: ds, type: "FULL" } : d)));
  }

  function setPartial(ds: string) {
    const defaultFrom = shift?.startTime ?? "09:00";
    const defaultTo   = shift?.endTime   ?? "17:00";
    onChange(
      value.map((d) =>
        d.date === ds ? { date: ds, type: "PARTIAL", leaveFrom: defaultFrom, leaveTo: defaultTo } : d
      )
    );
  }

  function setLeaveFrom(ds: string, leaveFrom: string) {
    onChange(
      value.map((d) =>
        d.date === ds && d.type === "PARTIAL" ? { ...d, leaveFrom } : d
      )
    );
  }

  function setLeaveTo(ds: string, leaveTo: string) {
    onChange(
      value.map((d) =>
        d.date === ds && d.type === "PARTIAL" ? { ...d, leaveTo } : d
      )
    );
  }

  function removeDay(ds: string) {
    onChange(value.filter((d) => d.date !== ds));
  }

  const sortedValue = [...value].sort((a, b) => a.date.localeCompare(b.date));
  const totalMins = sortedValue.reduce((sum, d) => sum + calcDayMinutes(shift, d), 0);

  return (
    <div>
      {/* Month navigation */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setDisplayMonth((m) => subMonths(m, 1))}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {format(displayMonth, "MMMM yyyy")}
        </span>
        <button
          type="button"
          onClick={() => setDisplayMonth((m) => addMonths(m, 1))}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="mb-1 grid grid-cols-7 text-center">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="py-1 text-xs font-medium text-zinc-400">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />;

          const ds = dateStr(day);
          const date = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
          const isPast = isBefore(date, today);
          const isWorkDay = workDays.includes(getDay(date));
          const sel = selMap.get(ds);
          const isSelected = !!sel;
          const isPartial = sel?.type === "PARTIAL";

          let cls =
            "flex h-8 w-full items-center justify-center rounded text-xs font-medium transition-colors ";

          if (isPast || !isWorkDay) {
            cls += "cursor-not-allowed text-zinc-300 dark:text-zinc-600";
          } else if (isPartial) {
            cls +=
              "cursor-pointer bg-blue-200 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300";
          } else if (isSelected) {
            cls += "cursor-pointer bg-blue-600 text-white";
          } else {
            cls +=
              "cursor-pointer text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700";
          }

          return (
            <button
              key={ds}
              type="button"
              disabled={isPast || !isWorkDay}
              onClick={() => toggleDay(day)}
              className={cls}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Selected days list */}
      {sortedValue.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {sortedValue.length} day{sortedValue.length !== 1 ? "s" : ""} selected
            </p>
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              {fmtMins(totalMins)} total
            </p>
          </div>

          {sortedValue.map((day) => {
            const mins = calcDayMinutes(shift, day);
            const label = format(parseISO(day.date), "EEE, MMM d");

            return (
              <div
                key={day.date}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {label}
                </span>

                {/* Full / Partial toggle */}
                <div className="flex overflow-hidden rounded border border-zinc-200 text-xs dark:border-zinc-600">
                  <button
                    type="button"
                    onClick={() => setFull(day.date)}
                    className={`px-2.5 py-1 transition-colors ${
                      day.type === "FULL"
                        ? "bg-blue-600 text-white"
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    }`}
                  >
                    Full
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartial(day.date)}
                    className={`border-l border-zinc-200 px-2.5 py-1 transition-colors dark:border-zinc-600 ${
                      day.type === "PARTIAL"
                        ? "bg-blue-600 text-white"
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    }`}
                  >
                    Partial
                  </button>
                </div>

                {/* Partial time range inputs */}
                {day.type === "PARTIAL" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-400">From</span>
                    <input
                      type="time"
                      value={day.leaveFrom}
                      onChange={(e) => setLeaveFrom(day.date, e.target.value)}
                      className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 focus:outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                    />
                    <span className="text-xs text-zinc-400">to</span>
                    <input
                      type="time"
                      value={day.leaveTo}
                      onChange={(e) => setLeaveTo(day.date, e.target.value)}
                      className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 focus:outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                    />
                  </div>
                )}

                <span className="w-8 text-right text-xs text-zinc-400">
                  {fmtMins(mins)}
                </span>

                <button
                  type="button"
                  onClick={() => removeDay(day.date)}
                  className="text-zinc-300 hover:text-zinc-500 dark:hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
