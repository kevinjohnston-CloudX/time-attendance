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
  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div className="flex gap-2">
        {(["payPeriod", "custom", "relative"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => {
              if (type === "payPeriod" && payPeriods[0]) {
                onChange({ type: "payPeriod", payPeriodId: payPeriods[0].id });
              } else if (type === "custom") {
                onChange({ type: "custom", startDate: "", endDate: "" });
              } else {
                onChange({ type: "relative", relativeDays: 30 });
              }
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              value.type === type
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
        <select
          value={value.payPeriodId}
          onChange={(e) =>
            onChange({ type: "payPeriod", payPeriodId: e.target.value })
          }
          className={inputCls + " max-w-sm"}
        >
          {payPeriods.map((pp) => {
            const start = new Date(pp.startDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            const end = new Date(pp.endDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            return (
              <option key={pp.id} value={pp.id}>
                {start} – {end} ({pp.status})
              </option>
            );
          })}
        </select>
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
      {value.type === "relative" && (
        <div className="flex flex-wrap gap-2">
          {[7, 14, 30, 60, 90].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => onChange({ type: "relative", relativeDays: days })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                value.relativeDays === days
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
