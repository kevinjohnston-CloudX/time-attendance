"use client";

import { useRouter } from "next/navigation";

type Option = { id: string; label: string };

export function OverviewPeriodFilter({
  options,
  selectedId,
}: {
  options: Option[];
  selectedId: string;
}) {
  const router = useRouter();

  return (
    <select
      value={selectedId}
      onChange={(e) => {
        const params = new URLSearchParams();
        params.set("overviewPeriodId", e.target.value);
        router.push(`/dashboard?${params.toString()}`);
      }}
      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
