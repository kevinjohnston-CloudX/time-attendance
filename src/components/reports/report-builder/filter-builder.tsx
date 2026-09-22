"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
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

/**
 * The rows that narrow a report: field, operator, value.
 *
 * <p>Every row is one clause and they are combined with AND — the query
 * builder has no OR — so the rows read as a list of conditions rather than an
 * expression, which is why they are a stack and not a nested builder.
 */
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
    <div className="flex flex-col gap-2.5">
      {filters.length === 0 && (
        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
          No filters — the report covers everyone in the date range.
        </p>
      )}

      {filters.map((filter, index) => {
        const fieldDef = filterFields.find((f) => f.id === filter.field);
        const valueOptions = getValueOptions(filter.field);

        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select
              value={filter.field}
              onChange={(e) => updateFilter(index, { field: e.target.value })}
              aria-label="Field"
              style={{ flex: "1 1 180px", maxWidth: 220 }}
            >
              {filterFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>

            <Select
              value={filter.operator}
              onChange={(e) =>
                updateFilter(index, { operator: e.target.value as FilterDef["operator"] })
              }
              aria-label="Operator"
              style={{ flex: "0 1 140px" }}
            >
              {(fieldDef?.operators ?? ["eq"]).map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_LABELS[op] ?? op}
                </option>
              ))}
            </Select>

            {valueOptions ? (
              <Select
                value={String(filter.value)}
                onChange={(e) => updateFilter(index, { value: e.target.value })}
                aria-label="Value"
                style={{ flex: "1 1 180px", maxWidth: 240 }}
              >
                <option value="">Select…</option>
                {valueOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            ) : (
              <div style={{ flex: "1 1 180px", maxWidth: 240 }}>
                <Input
                  type={
                    fieldDef?.type === "number" ? "number" : fieldDef?.type === "date" ? "date" : "text"
                  }
                  value={String(filter.value)}
                  onChange={(e) => updateFilter(index, { value: e.target.value })}
                  placeholder="Value"
                  aria-label="Value"
                />
              </div>
            )}

            {filter.operator === "between" && (
              <div style={{ flex: "0 1 180px" }}>
                <Input
                  type={fieldDef?.type === "number" ? "number" : "date"}
                  value={String(filter.value2 ?? "")}
                  onChange={(e) => updateFilter(index, { value2: e.target.value })}
                  placeholder="To"
                  aria-label="Upper bound"
                />
              </div>
            )}

            <Button
              hierarchy="tertiary"
              tone="error"
              iconOnly
              title="Remove this filter"
              aria-label="Remove this filter"
              onClick={() => removeFilter(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <div>
        <Button
          hierarchy="link"
          onClick={addFilter}
          leadingIcon={<Plus className="h-4 w-4" />}
          disabled={filterFields.length === 0}
        >
          Add filter
        </Button>
      </div>
    </div>
  );
}
