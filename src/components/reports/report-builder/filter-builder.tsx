"use client";

import { Plus, Trash2 } from "lucide-react";
import type { FilterDef } from "@/lib/validators/report.schema";

interface FilterFieldDef {
  id: string;
  label: string;
  type: string;
  operators: string[];
  options?: { value: string; label: string }[];
}

interface FilterOption {
  sites: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

const OPERATOR_LABELS: Record<string, string> = {
  eq: "equals",
  neq: "not equal",
  in: "in",
  notIn: "not in",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  between: "between",
  contains: "contains",
};

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-zinc-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";

export function FilterBuilder({
  filterFields,
  filters,
  onChange,
  filterOptions,
}: {
  filterFields: FilterFieldDef[];
  filters: FilterDef[];
  onChange: (filters: FilterDef[]) => void;
  filterOptions?: FilterOption;
}) {
  function addFilter() {
    const field = filterFields[0];
    if (!field) return;
    onChange([
      ...filters,
      { field: field.id, operator: (field.operators[0] ?? "eq") as FilterDef["operator"], value: "" },
    ]);
  }

  function updateFilter(index: number, updates: Partial<FilterDef>) {
    const updated = [...filters];
    updated[index] = { ...updated[index], ...updates };

    // If field changed, reset operator and value
    if (updates.field) {
      const fieldDef = filterFields.find((f) => f.id === updates.field);
      if (fieldDef) {
        updated[index].operator = (fieldDef.operators[0] ?? "eq") as FilterDef["operator"];
        updated[index].value = "";
      }
    }

    onChange(updated);
  }

  function removeFilter(index: number) {
    onChange(filters.filter((_, i) => i !== index));
  }

  function getValueOptions(fieldId: string): { value: string; label: string }[] | null {
    const fieldDef = filterFields.find((f) => f.id === fieldId);
    if (fieldDef?.options) return fieldDef.options;

    // Dynamic options from filterOptions
    if (fieldId === "siteId" && filterOptions?.sites) {
      return filterOptions.sites.map((s) => ({ value: s.id, label: s.name }));
    }
    if (fieldId === "departmentId" && filterOptions?.departments) {
      return filterOptions.departments.map((d) => ({ value: d.id, label: d.name }));
    }

    return null;
  }

  return (
    <div className="space-y-3">
      {filters.map((filter, index) => {
        const fieldDef = filterFields.find((f) => f.id === filter.field);
        const valueOptions = getValueOptions(filter.field);

        return (
          <div key={index} className="flex items-center gap-2">
            {/* Field select */}
            <select
              value={filter.field}
              onChange={(e) => updateFilter(index, { field: e.target.value })}
              className={inputCls + " max-w-[180px]"}
            >
              {filterFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>

            {/* Operator select */}
            <select
              value={filter.operator}
              onChange={(e) =>
                updateFilter(index, {
                  operator: e.target.value as FilterDef["operator"],
                })
              }
              className={inputCls + " max-w-[120px]"}
            >
              {(fieldDef?.operators ?? ["eq"]).map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_LABELS[op] ?? op}
                </option>
              ))}
            </select>

            {/* Value input */}
            {valueOptions ? (
              <select
                value={String(filter.value)}
                onChange={(e) => updateFilter(index, { value: e.target.value })}
                className={inputCls + " max-w-[200px]"}
              >
                <option value="">Select...</option>
                {valueOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={fieldDef?.type === "number" ? "number" : fieldDef?.type === "date" ? "date" : "text"}
                value={String(filter.value)}
                onChange={(e) => updateFilter(index, { value: e.target.value })}
                placeholder="Value"
                className={inputCls + " max-w-[200px]"}
              />
            )}

            {/* Between: second value */}
            {filter.operator === "between" && (
              <input
                type={fieldDef?.type === "number" ? "number" : "date"}
                value={String(filter.value2 ?? "")}
                onChange={(e) => updateFilter(index, { value2: e.target.value })}
                placeholder="To"
                className={inputCls + " max-w-[150px]"}
              />
            )}

            <button
              type="button"
              onClick={() => removeFilter(index)}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addFilter}
        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        <Plus className="h-4 w-4" />
        Add filter
      </button>
    </div>
  );
}
