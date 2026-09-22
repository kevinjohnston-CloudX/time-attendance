"use client";

import { Button, Checkbox } from "@/components/ui";

interface Column {
  id: string;
  label: string;
  type: string;
}

/**
 * Which fields the report carries, as the design's column section: a wrapped
 * grid of checkboxes, three across when there is room.
 *
 * <p>The column's type is shown beside its name because two of the data
 * sources offer both a number and a string for the same idea — "Duration
 * (min)" and "Duration" — and picking the wrong one produces a report that
 * cannot be summed.
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

  function toggleAll() {
    if (allSelected) onChange([]);
    else onChange(columns.map((c) => c.id));
  }

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" hierarchy="secondary" onClick={toggleAll}>
          {allSelected ? "Clear all" : "Select all"}
        </Button>
        {/* The count is the only thing that says a report with no columns
            cannot be run, before the Save button silently refuses. */}
        <span
          className="tabular"
          style={{
            font: "var(--type-body2)",
            color: selected.length === 0 ? "var(--text-error)" : "var(--text-secondary)",
          }}
        >
          {selected.length} of {columns.length} selected
        </span>
      </div>

      <div className="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,30%)),1fr))]">
        {columns.map((col) => (
          <div key={col.id} className="flex items-center gap-2.5 py-1.5">
            <Checkbox
              checked={selected.includes(col.id)}
              onChange={() => toggle(col.id)}
              label={
                <span className="inline-flex items-baseline gap-1.5">
                  {col.label}
                  <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                    {col.type}
                  </span>
                </span>
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
