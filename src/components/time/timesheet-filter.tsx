"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "@/components/layout/navigation-progress";
import { useState } from "react";
import { fieldCls, smFieldCls } from "@/components/ui/form-classes";

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

  const inputCls = smFieldCls;

  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <select
        value={filter}
        onChange={(e) => handleSelect(e.target.value as FilterOption)}
        className={fieldCls}
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
              <label className="mb-1 block text-xs text-[var(--text-tertiary)]">From</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-[var(--text-tertiary)]">To</label>
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
            className="rounded-lg bg-[var(--fill-accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-on-accent)] hover:bg-[var(--fill-accent-hover)] disabled:opacity-40"
          >
            Apply Range
          </button>
        </div>
      )}
    </div>
  );
}
