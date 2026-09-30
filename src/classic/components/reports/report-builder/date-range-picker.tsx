"use client";

import type { DateRange } from "@/lib/validators/report.schema";

interface PayPeriodOption {
  id: string;
  startDate: string | Date;
  endDate: string | Date;
  status: string;
  /** The last day worked, yyyy-MM-dd, from the shared action (see lastDayOf). */
  lastDay?: string;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function DateRangePicker({
  value,
  onChange,
  payPeriods,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  payPeriods: PayPeriodOption[];
}) {
  const today = new Date();
  // Prefer the OPEN period whose window contains today; fall back to first OPEN, then first overall.
  const activePeriod =
    payPeriods.find(
      (p) =>
        p.status === "OPEN" &&
        new Date(p.startDate) <= today &&
        new Date(p.endDate) >= today
    ) ??
    payPeriods.find((p) => p.status === "OPEN") ??
    payPeriods[0];

  function formatPeriodLabel(pp: PayPeriodOption) {
    const start = new Date(pp.startDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    // The stored end is often the next period's first day; lastDay is the
    // day the period actually ends on. Noon, so no time zone moves the day.
    const end = (pp.lastDay ? new Date(`${pp.lastDay}T12:00:00`) : new Date(pp.endDate)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${start} – ${end}`;
  }

  function isCurrent(pp: PayPeriodOption) {
    return new Date(pp.startDate) <= today && new Date(pp.endDate) >= today;
  }

  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div className="flex gap-2">
        {(["payPeriod", "custom", "relative"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => {
              if (type === "payPeriod" && activePeriod) {
                onChange({ type: "payPeriod", payPeriodId: activePeriod.id });
              } else if (type === "custom") {
                onChange({ type: "custom", startDate: "", endDate: "" });
              } else {
                onChange({ type: "relative", relativeDays: 30 });
              }
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              (value.type === type ||
                (type === "relative" && (value.type === "today" || value.type === "yesterday")))
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {type === "payPeriod"
              ? "Pay Period"
              : type === "custom"
                ? "Custom Range"
                : "Relative"}
          </button>
        ))}
      </div>

      {/* Pay period dropdown */}
      {value.type === "payPeriod" && (
        <div className="flex items-center gap-3">
          <select
            value={value.payPeriodId}
            onChange={(e) => onChange({ type: "payPeriod", payPeriodId: e.target.value })}
            className={inputCls + " max-w-xs"}
          >
            {payPeriods.map((pp) => (
              <option key={pp.id} value={pp.id}>
                {formatPeriodLabel(pp)}{isCurrent(pp) ? "  (Current)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Custom date range */}
      {value.type === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value.startDate}
            onChange={(e) =>
              onChange({ ...value, startDate: e.target.value })
            }
            className={inputCls + " max-w-[180px]"}
          />
          <span className="text-sm text-zinc-500">to</span>
          <input
            type="date"
            value={value.endDate}
            onChange={(e) =>
              onChange({ ...value, endDate: e.target.value })
            }
            className={inputCls + " max-w-[180px]"}
          />
        </div>
      )}

      {/* Relative days */}
      {(value.type === "relative" || value.type === "today" || value.type === "yesterday") && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange({ type: "today" })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              value.type === "today"
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onChange({ type: "yesterday" })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              value.type === "yesterday"
                ? "bg-blue-600 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            Yesterday
          </button>
          {[7, 14, 30, 60, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => onChange({ type: "relative", relativeDays: days })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                value.type === "relative" && value.relativeDays === days
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              Last {days} days
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
