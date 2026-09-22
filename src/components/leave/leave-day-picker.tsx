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
import { Button, SegmentedControl } from "@/components/ui";

/**
 * Pick the days you are asking off, and how much of each.
 *
 * <p>A month grid rather than a from/to pair, because leave here is a set of
 * days and not a range: a Thursday-and-the-following-Monday request is one
 * request, and a range control forces it to be two or to swallow the weekend.
 *
 * <p>Hours are derived from the shift, never typed, except on a partial day.
 * Whatever this shows has to agree with what the accrual engine deducts, and
 * the engine works from the shift too.
 */

export type DaySelection =
  | { date: string; type: "FULL" }
  | { date: string; type: "PARTIAL"; minutes: number };

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

const DURATION_SEGMENTS = [
  { value: "FULL", label: "Full" },
  { value: "PARTIAL", label: "Partial" },
];

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function calcDayMinutes(shift: ShiftInfo | null, day: DaySelection): number {
  const start    = shift ? timeToMins(shift.startTime) : 9 * 60;
  const end      = shift ? timeToMins(shift.endTime)   : 17 * 60;
  const mealMins = shift?.mealBreakMinutes ?? 0;

  if (day.type === "FULL") return (end - start) - mealMins;
  return day.minutes;
}

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
    const fullMins = calcDayMinutes(shift, { date: ds, type: "FULL" });
    const defaultMins = Math.round(fullMins / 2 / 15) * 15;
    onChange(
      value.map((d) =>
        d.date === ds ? { date: ds, type: "PARTIAL", minutes: defaultMins } : d
      )
    );
  }

  function setMinutes(ds: string, minutes: number) {
    onChange(
      value.map((d) =>
        d.date === ds && d.type === "PARTIAL" ? { ...d, minutes } : d
      )
    );
  }

  function removeDay(ds: string) {
    onChange(value.filter((d) => d.date !== ds));
  }

  const sortedValue = [...value].sort((a, b) => a.date.localeCompare(b.date));
  const totalMins = sortedValue.reduce((sum, d) => sum + calcDayMinutes(shift, d), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <NavButton label="Previous month" onClick={() => setDisplayMonth((m) => subMonths(m, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </NavButton>
        <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>
          {format(displayMonth, "MMMM yyyy")}
        </span>
        <NavButton label="Next month" onClick={() => setDisplayMonth((m) => addMonths(m, 1))}>
          <ChevronRight className="h-4 w-4" />
        </NavButton>
      </div>

      <div className="grid grid-cols-7 text-center">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="wms-overline py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} />;

          const ds = dateStr(day);
          const date = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day);
          const isPast = isBefore(date, today);
          const isWorkDay = workDays.includes(getDay(date));
          const disabled = isPast || !isWorkDay;
          const sel = selMap.get(ds);
          const isPartial = sel?.type === "PARTIAL";

          // Three states, three fills. A partial day is the accent surface
          // rather than the accent fill, so a half day never reads as a whole
          // one from across the desk.
          const tone = disabled
            ? { background: "transparent", color: "var(--text-disabled)", border: "1px solid transparent" }
            : isPartial
              ? {
                  background: "var(--surface-info)",
                  color: "var(--text-accent)",
                  border: "1px solid var(--stroke-accent)",
                }
              : sel
                ? {
                    background: "var(--fill-accent)",
                    color: "var(--text-on-accent)",
                    border: "1px solid var(--fill-accent)",
                  }
                : {
                    background: "transparent",
                    color: "var(--text-primary)",
                    border: "1px solid transparent",
                  };

          return (
            <button
              key={ds}
              type="button"
              disabled={disabled}
              onClick={() => toggleDay(day)}
              aria-pressed={!!sel}
              className={`tabular flex h-8 w-full items-center justify-center rounded${disabled || sel ? "" : " ta-hoverable"}`}
              style={{
                ...tone,
                font: "var(--type-body2)",
                fontWeight: "var(--weight-medium)",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "background-color 120ms ease",
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {sortedValue.length > 0 && (
        <div
          className="flex flex-col gap-2 pt-3"
          style={{ borderTop: "1px solid var(--stroke-divider)" }}
        >
          <div className="flex items-center justify-between">
            <span className="wms-overline">
              {sortedValue.length} day{sortedValue.length !== 1 ? "s" : ""} selected
            </span>
            <span
              className="tabular"
              style={{
                font: "var(--type-body1)",
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-primary)",
              }}
            >
              {fmtMins(totalMins)} total
            </span>
          </div>

          {sortedValue.map((day) => {
            const mins = calcDayMinutes(shift, day);
            const label = format(parseISO(day.date), "EEE, MMM d");

            return (
              <div
                key={day.date}
                className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
                style={{
                  border: "1px solid var(--stroke-secondary)",
                  background: "var(--surface-secondary)",
                }}
              >
                <span className="flex-1" style={{ font: "var(--type-body1)" }}>
                  {label}
                </span>

                {/* Re-picking the segment that is already on would otherwise
                    throw away typed partial hours, because setPartial resets
                    them to half a shift. */}
                <SegmentedControl
                  size="sm"
                  ariaLabel={`Duration for ${label}`}
                  items={DURATION_SEGMENTS}
                  value={day.type}
                  onChange={(next) => {
                    if (next === day.type) return;
                    if (next === "FULL") setFull(day.date);
                    else setPartial(day.date);
                  }}
                />

                {day.type === "PARTIAL" && (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="23"
                      step="1"
                      aria-label={`Hours off on ${label}`}
                      value={Math.floor(day.minutes / 60)}
                      onChange={(e) => {
                        const h = Math.max(0, parseInt(e.target.value) || 0);
                        setMinutes(day.date, h * 60 + (day.minutes % 60));
                      }}
                      className="ta-cell w-12"
                      style={{ minWidth: 0 }}
                    />
                    <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>h</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      step="1"
                      aria-label={`Minutes off on ${label}`}
                      value={day.minutes % 60}
                      onChange={(e) => {
                        const m = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                        setMinutes(day.date, Math.floor(day.minutes / 60) * 60 + m);
                      }}
                      className="ta-cell w-12"
                      style={{ minWidth: 0 }}
                    />
                    <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>m</span>
                  </div>
                )}

                <span
                  className="tabular w-12 text-right"
                  style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}
                >
                  {fmtMins(mins)}
                </span>

                <Button
                  hierarchy="tertiary"
                  size="sm"
                  iconOnly
                  aria-label={`Remove ${label}`}
                  onClick={() => removeDay(day.date)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Month stepper, matching the one on the leave calendar. */
function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="ta-field inline-flex h-[26px] w-[26px] items-center justify-center rounded-md"
      style={{
        border: "1px solid var(--stroke-secondary)",
        background: "var(--surface-card)",
        color: "var(--icon-secondary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
