"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

type FilterOption = "all" | "current" | "last" | "custom";

export function TimesheetFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filter, setFilter] = useState<FilterOption>(
    (searchParams.get("filter") as FilterOption) ?? "all"
  );
  const [customStart, setCustomStart] = useState(searchParams.get("customStart") ?? "");
  const [customEnd, setCustomEnd] = useState(searchParams.get("customEnd") ?? "");

  function push(newFilter: FilterOption, start?: string, end?: string) {
    const params = new URLSearchParams();
    const id = searchParams.get("id");
    if (id) params.set("id", id);
    if (newFilter !== "all") params.set("filter", newFilter);
    if (newFilter === "custom" && start) params.set("customStart", start);
    if (newFilter === "custom" && end) params.set("customEnd", end);
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleSelect(value: FilterOption) {
    setFilter(value);
    if (value !== "custom") push(value);
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <select
        value={filter}
        onChange={(e) => handleSelect(e.target.value as FilterOption)}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      >
        <option value="all">All Pay Periods</option>
        <option value="current">Current Pay Period</option>
        <option value="last">Last Pay Period</option>
        <option value="custom">Custom Date Range</option>
      </select>

      {filter === "custom" && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">From</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">To</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <button
            onClick={() => push("custom", customStart, customEnd)}
            disabled={!customStart || !customEnd}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Apply Range
          </button>
        </div>
      )}
    </div>
  );
}
