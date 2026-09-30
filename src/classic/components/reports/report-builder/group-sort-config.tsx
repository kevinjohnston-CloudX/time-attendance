"use client";

import { Plus, Trash2 } from "lucide-react";
import type { SortDef } from "@/lib/validators/report.schema";

interface Column {
  id: string;
  label: string;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function GroupSortConfig({
  columns,
  groupableFields,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
}: {
  columns: Column[];
  groupableFields: string[];
  groupBy: string[];
  onGroupByChange: (groupBy: string[]) => void;
  sortBy: SortDef[];
  onSortByChange: (sortBy: SortDef[]) => void;
}) {
  // ─── Group By ──────────────────────────────────────────────────────────
  const groupableOptions = columns.filter((c) =>
    groupableFields.includes(c.id)
  );

  function toggleGroup(id: string) {
    if (groupBy.includes(id)) {
      onGroupByChange(groupBy.filter((g) => g !== id));
    } else {
      onGroupByChange([...groupBy, id]);
    }
  }

  // ─── Sort By ───────────────────────────────────────────────────────────
  function addSort() {
    const firstCol = columns[0];
    if (!firstCol) return;
    onSortByChange([...sortBy, { field: firstCol.id, direction: "asc" }]);
  }

  function updateSort(index: number, updates: Partial<SortDef>) {
    const updated = [...sortBy];
    updated[index] = { ...updated[index], ...updates };
    onSortByChange(updated);
  }

  function removeSort(index: number) {
    onSortByChange(sortBy.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-6">
      {/* Group By */}
      {groupableOptions.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Group By
          </h3>
          <div className="flex flex-wrap gap-2">
            {groupableOptions.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => toggleGroup(col.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  groupBy.includes(col.id)
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {col.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sort By */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Sort By
        </h3>
        <div className="space-y-2">
          {sortBy.map((sort, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={sort.field}
                onChange={(e) => updateSort(index, { field: e.target.value })}
                className={inputCls + " max-w-[200px]"}
              >
                {columns.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.label}
                  </option>
                ))}
              </select>
              <select
                value={sort.direction}
                onChange={(e) =>
                  updateSort(index, {
                    direction: e.target.value as "asc" | "desc",
                  })
                }
                className={inputCls + " max-w-[120px]"}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button
                type="button"
                onClick={() => removeSort(index)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addSort}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            <Plus className="h-4 w-4" />
            Add sort
          </button>
        </div>
      </div>
    </div>
  );
}
