"use client";

import { Select } from "@/components/ui";
import type { AcrossSpec } from "@/lib/reports/across";

interface Column {
  id: string;
  label: string;
  type: string;
  across?: boolean;
}

/**
 * One field spread across the columns: a column for each day of the week,
 * date or pay code, each holding the hours picked, added up. The rows are
 * combined by the other columns shown, so it says which ones those are.
 */
export function AcrossConfig({
  columns,
  selected,
  across,
  onChange,
}: {
  /** Every column the report type has. */
  columns: Column[];
  /** The columns shown, in order. */
  selected: string[];
  across: AcrossSpec | undefined;
  onChange: (across: AcrossSpec | undefined) => void;
}) {
  const fields = columns.filter((c) => c.across);
  const values = columns.filter((c) => c.type === "number");
  if (fields.length === 0 || values.length === 0) return null;

  const field = fields.find((c) => c.id === across?.field);
  const value = values.find((c) => c.id === across?.value) ?? values.find((c) => selected.includes(c.id)) ?? values[0];
  const labelOf = new Map(columns.map((c) => [c.id, c.label]));
  const rowsBy = selected
    .filter((id) => id !== field?.id && columns.find((c) => c.id === id)?.type !== "number")
    .map((id) => labelOf.get(id) ?? id);

  return (
    <div className="flex flex-col gap-2">
      <span style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
        Spread across columns
      </span>
      <div className="flex flex-col gap-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>A column for each</span>
          <Select
            value={field?.id ?? ""}
            onChange={(e) => onChange(e.target.value ? { field: e.target.value, value: value.id } : undefined)}
            aria-label="A column for each"
          >
            <option value="">Nothing</option>
            {fields.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>Showing</span>
          <Select
            value={value.id}
            disabled={!field}
            onChange={(e) => field && onChange({ field: field.id, value: e.target.value })}
            aria-label="Showing"
          >
            {values.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
        {field
          ? rowsBy.length
            ? `One row for each ${rowsBy.join(", ").toLowerCase()}, with the ${value.label.toLowerCase()} for each ${field.label.toLowerCase()} beside it and a total.`
            : `Pick a column such as Employee to have a row for each.`
          : "For example, a column for each day of the week, with the hours worked that day."}
      </span>
    </div>
  );
}
