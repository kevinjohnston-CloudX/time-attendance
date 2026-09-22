"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Select } from "@/components/ui";
import type { SortDef } from "@/lib/validators/report.schema";

interface Column {
  id: string;
  label: string;
}

/**
 * How the rows are rolled up, and in what order they come out.
 *
 * <p>Grouping is checkboxes rather than a single Select because more than one
 * field can be grouped on and the order they are ticked in is the nesting
 * order — Department then Shift is not the same report as Shift then
 * Department, and a multi-select gives no way to see which you asked for.
 */
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
  const groupableOptions = columns.filter((c) => groupableFields.includes(c.id));

  function toggleGroup(id: string) {
    if (groupBy.includes(id)) {
      onGroupByChange(groupBy.filter((g) => g !== id));
    } else {
      onGroupByChange([...groupBy, id]);
    }
  }

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
    <div className="flex flex-col gap-5">
      {groupableOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="wms-overline">Group By</span>
          <div className="grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,30%)),1fr))]">
            {groupableOptions.map((col) => {
              const position = groupBy.indexOf(col.id);
              return (
                <div key={col.id} className="flex items-center gap-2.5 py-1.5">
                  <Checkbox
                    checked={position >= 0}
                    onChange={() => toggleGroup(col.id)}
                    label={
                      <span className="inline-flex items-baseline gap-1.5">
                        {col.label}
                        {/* The nesting order, said out loud. Ticking three
                            boxes otherwise gives no clue which one the report
                            breaks on first. */}
                        {position >= 0 && (
                          <span
                            className="tabular"
                            style={{ font: "var(--type-caption1)", color: "var(--text-accent)" }}
                          >
                            {position + 1}
                          </span>
                        )}
                      </span>
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="wms-overline">Sort By</span>

        {sortBy.length === 0 && (
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
            Unsorted — rows come back in the data source&rsquo;s own order.
          </p>
        )}

        {sortBy.map((sort, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select
              value={sort.field}
              onChange={(e) => updateSort(index, { field: e.target.value })}
              aria-label="Sort field"
              style={{ flex: "1 1 200px", maxWidth: 240 }}
            >
              {columns.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.label}
                </option>
              ))}
            </Select>
            <Select
              value={sort.direction}
              onChange={(e) =>
                updateSort(index, { direction: e.target.value as "asc" | "desc" })
              }
              aria-label="Sort direction"
              style={{ flex: "0 1 140px" }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </Select>
            <Button
              hierarchy="tertiary"
              tone="error"
              iconOnly
              title="Remove this sort"
              aria-label="Remove this sort"
              onClick={() => removeSort(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div>
          <Button
            hierarchy="link"
            onClick={addSort}
            leadingIcon={<Plus className="h-4 w-4" />}
            disabled={columns.length === 0}
          >
            Add sort
          </Button>
        </div>
      </div>
    </div>
  );
}
