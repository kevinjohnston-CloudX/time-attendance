"use client";

import { useState } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { PAY_PERIOD_STATUS_LABEL } from "@/lib/state-machines/labels";
import type { PayPeriodPreset } from "@/lib/punch-history/punch-history-data";

/**
 * The date control from the Team Punch History handoff: a button naming the
 * range, opening onto the recent pay periods beside a month you pick a start
 * and an end from.
 *
 * <p>Every date here is a "yyyy-MM-dd" string on the site's calendar, which
 * the server already worked out. The month grid only does calendar arithmetic
 * on them, never time of day, so the browser's own timezone cannot move a day.
 */

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Noon, so no daylight saving change can tip the date either way. */
export function parseDay(iso: string): Date {
  return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12);
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Mon, Sep 7", or "Sep 7" without the weekday. */
export function dayLabel(iso: string, withWeekday = false): string {
  const d = parseDay(iso);
  return `${withWeekday ? `${DOW[d.getDay()]}, ` : ""}${MONTH[d.getMonth()]} ${d.getDate()}`;
}

/** "Sep 7 – Sep 20, 2026", "Tue, Sep 15, 2026", or both years when they differ. */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return `${dayLabel(from, true)}, ${from.slice(0, 4)}`;
  if (from.slice(0, 4) !== to.slice(0, 4)) {
    return `${dayLabel(from)}, ${from.slice(0, 4)} – ${dayLabel(to)}, ${to.slice(0, 4)}`;
  }
  return `${dayLabel(from)} – ${dayLabel(to)}, ${to.slice(0, 4)}`;
}

function presetCaption(p: PayPeriodPreset, i: number, all: PayPeriodPreset[]): string {
  const which = p.isCurrent
    ? "Current pay period"
    : i === 1 && all[0]?.isCurrent
      ? "Previous pay period"
      : null;
  const status = p.status ? PAY_PERIOD_STATUS_LABEL[p.status] : null;
  return [which, status].filter(Boolean).join(" · ");
}

export function PunchHistoryDatePicker({
  startDate,
  endDate,
  today,
  payPeriods,
  isCustomRange,
  open,
  onOpenChange,
  onPick,
}: {
  startDate: string;
  endDate: string;
  today: string;
  payPeriods: PayPeriodPreset[];
  isCustomRange: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (from: string, to: string) => void;
}) {
  // The month on show, as year * 12 + month, and the two ends being picked.
  const [month, setMonth] = useState(() => +startDate.slice(0, 4) * 12 + (+startDate.slice(5, 7) - 1));
  const [a, setA] = useState<string | null>(startDate);
  const [b, setB] = useState<string | null>(endDate);
  const [hover, setHover] = useState<string | null>(null);

  function toggle() {
    if (!open) {
      // Reopening always starts from the range in force, not a half-finished
      // pick left over from last time.
      setA(startDate);
      setB(endDate);
      setHover(null);
      setMonth(+startDate.slice(0, 4) * 12 + (+startDate.slice(5, 7) - 1));
    }
    onOpenChange(!open);
  }

  function pick(day: string) {
    if (!a || (a && b)) {
      setA(day);
      setB(null);
      setHover(null);
    } else if (day < a) {
      setA(day);
    } else {
      setB(day);
      onPick(a, day);
    }
  }

  const first = new Date(Math.floor(month / 12), month % 12, 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const reach = b ?? hover;

  return (
    <div className="relative flex">
      <button
        type="button"
        onClick={toggle}
        title="Pick a date range"
        aria-expanded={open}
        className="ta-field tabular inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md pl-[11px] pr-2.5"
        style={{
          border: `1px solid ${isCustomRange ? "var(--stroke-accent)" : "var(--stroke-default)"}`,
          background: "var(--surface-card)",
          color: "var(--text-primary)",
          font: "var(--type-body1)",
          fontWeight: "var(--weight-medium)",
          cursor: "pointer",
        }}
      >
        <Calendar className="h-4 w-4 flex-none" style={{ color: "var(--icon-secondary)" }} />
        <span>{rangeLabel(startDate, endDate)}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-none" style={{ color: "var(--icon-tertiary)" }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => onOpenChange(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Date range"
            className="absolute left-0 top-[calc(100%+6px)] z-40 flex w-[560px] max-w-[calc(100vw-48px)] flex-wrap overflow-hidden"
            style={{
              border: "1px solid var(--stroke-secondary)",
              borderRadius: "var(--radius-l)",
              background: "var(--surface-card)",
              boxShadow: "var(--shadow-menu)",
            }}
          >
            <div
              className="flex flex-[1_1_180px] flex-col gap-1 px-2 py-2.5"
              style={{ borderRight: "1px solid var(--stroke-divider)", background: "var(--surface-tertiary)" }}
            >
              <span className="wms-overline px-2.5 py-1">Pay periods</span>
              {payPeriods.length === 0 && (
                <span className="px-2.5 py-2" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  No pay periods yet
                </span>
              )}
              {payPeriods.map((p, i) => {
                const on = p.startDate === startDate && p.endDate === endDate;
                const caption = presetCaption(p, i, payPeriods);
                return (
                  <button
                    key={`${p.startDate}|${p.endDate}`}
                    type="button"
                    onClick={() => onPick(p.startDate, p.endDate)}
                    className="ta-outlined flex w-full flex-col items-start gap-px rounded-md px-2.5 py-2 text-left"
                    style={{
                      border: `1px solid ${on ? "var(--stroke-accent)" : "transparent"}`,
                      background: on ? "var(--surface-card)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      className="tabular whitespace-nowrap"
                      style={{
                        font: "var(--type-body1)",
                        fontWeight: "var(--weight-medium)",
                        color: on ? "var(--text-accent)" : "var(--text-primary)",
                      }}
                    >
                      {dayLabel(p.startDate)} – {dayLabel(p.endDate)}
                    </span>
                    {caption && (
                      <span style={{ font: "var(--type-caption1)", color: "var(--text-secondary)" }}>{caption}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-[2_1_300px] flex-col gap-2 px-3.5 py-3">
              <div className="flex items-center justify-between">
                <Button hierarchy="tertiary" iconOnly aria-label="Previous month" onClick={() => setMonth((m) => m - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span style={{ font: "var(--type-body1)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                  {MONTH_LONG[first.getMonth()]} {first.getFullYear()}
                </span>
                <Button hierarchy="tertiary" iconOnly aria-label="Next month" onClick={() => setMonth((m) => m + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHover(null)}>
                {DOW_SHORT.map((d) => (
                  <span
                    key={d}
                    className="pb-1 pt-0.5 text-center"
                    style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}
                  >
                    {d}
                  </span>
                ))}
                {Array.from({ length: weeks * 7 }, (_, i) => {
                  const d = new Date(gridStart);
                  d.setDate(gridStart.getDate() + i);
                  const iso = isoOf(d);
                  const inMonth = d.getMonth() === first.getMonth();
                  const endpoint = iso === a || iso === b;
                  const inside = !!a && !!reach && iso > a && iso < reach;
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => pick(iso)}
                      onMouseEnter={() => a && !b && setHover(iso)}
                      className="ta-day tabular h-9 rounded-md"
                      style={{
                        border: 0,
                        font: "var(--type-body1)",
                        fontWeight: endpoint ? "var(--weight-semibold)" : "var(--weight-regular)",
                        background: endpoint ? "var(--fill-accent)" : inside ? "var(--surface-info)" : "transparent",
                        color: endpoint
                          ? "var(--text-on-accent)"
                          : inside
                            ? "var(--text-accent)"
                            : inMonth
                              ? "var(--text-primary)"
                              : "var(--text-disabled)",
                        // Today is a hairline, never a fill, so it cannot be
                        // mistaken for one end of the range being picked.
                        boxShadow: iso === today && !endpoint && !inside ? "inset 0 0 0 1px var(--stroke-accent)" : "none",
                        cursor: "pointer",
                      }}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 pt-2" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
                <span className="flex-1" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                  {a && !b ? "Select an end date" : "Select a start date"}
                </span>
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  onClick={() => {
                    setA(null);
                    setB(null);
                    setHover(null);
                  }}
                >
                  Clear
                </Button>
                <Button hierarchy="secondary" size="sm" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
