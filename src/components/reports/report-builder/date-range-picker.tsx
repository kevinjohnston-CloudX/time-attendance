"use client";

import type { DateRange } from "@/lib/validators/report.schema";

interface PayPeriodOption {
  id: string;
  startDate: string | Date;
  endDate: string | Date;
  status: string;
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
  const activePeriod =
    payPeriods.find((p) => p.status === "OPEN") ?? payPeriods[0];

  function formatPeriodLabel(pp: PayPeriodOption) {
    const start = new Date(pp.startDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const end = new Date(pp.endDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${start} – ${end}`;
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

      {/* Current pay period label — no dropdown */}
      {value.type === "payPeriod" && activePeriod && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatPeriodLabel(activePeriod)}
          <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Current
          </span>
        </p>
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
