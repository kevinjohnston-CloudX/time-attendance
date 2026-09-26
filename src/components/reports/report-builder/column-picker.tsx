"use client";

import { Button, Checkbox } from "@/components/ui";

interface Column {
  id: string;
  label: string;
  type: string;
}

/**
 * Which columns the report carries, as checkboxes two across in the
 * builder's side rail. The report lists them in this same order.
 */
export function ColumnPicker({
  columns,
  selected,
  onChange,
}: {
  columns: Column[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const allSelected = selected.length === columns.length;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))]">
        {columns.map((col) => (
          <div key={col.id} className="flex min-w-0 items-center py-1">
            <Checkbox checked={selected.includes(col.id)} onChange={() => toggle(col.id)} label={col.label} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* The count is what says a report with no columns cannot run,
            before the Save button refuses without a reason. */}
        <span
          className="tabular"
          style={{
            font: "var(--type-body2)",
            color: selected.length === 0 ? "var(--text-error)" : "var(--text-tertiary)",
          }}
        >
          {selected.length === 0 ? "Pick at least one column" : `${selected.length} of ${columns.length} columns`}
        </span>
        <Button size="sm" hierarchy="link" onClick={() => onChange(allSelected ? [] : columns.map((c) => c.id))}>
          {allSelected ? "Clear all" : "Select all"}
        </Button>
      </div>
    </div>
  );
}
