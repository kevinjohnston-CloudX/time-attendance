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
  leaveTypes?: { id: string; name: string }[];
}

/**
 * Operators as a sentence reads them: "Department is Packing". With one value
 * to pick, "is one of" and "is" do the same thing, so the list offers "is"
 * and drops the other, unless a saved report already uses it.
 */
const OPERATOR_LABELS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  in: "is",
  notIn: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  between: "is between",
  contains: "contains",
};

function offeredOperators(operators: string[], current: string): string[] {
  return operators.filter(
    (op) =>
      op === current ||
      !((op === "in" && operators.includes("eq")) || (op === "notIn" && operators.includes("neq")))
  );
}

/**
 * The conditions that narrow a report: field, operator, value.
 *
 * <p>Every row is one condition and they all have to be true together (the
 * query builder has no OR), so they read as a plain list rather than an
 * expression.
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
    // Time off types were a free text box asking for an internal id.
    if (fieldId === "leaveTypeId" && filterOptions?.leaveTypes) {
      return filterOptions.leaveTypes.map((t) => ({ value: t.id, label: t.name }));
    }

    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {filters.length === 0 && (
        <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-tertiary)" }}>
          Everyone in these dates is included.
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
              aria-label="Condition"
              style={{ flex: "0 1 140px" }}
            >
              {offeredOperators(fieldDef?.operators ?? ["eq"], filter.operator).map((op) => (
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
                <option value="">Choose one</option>
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
                  placeholder="Type a value"
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
                  placeholder="and"
                  aria-label="Upper bound"
                />
              </div>
            )}

            {(String(filter.value ?? "").trim() === "" ||
              (filter.operator === "between" && String(filter.value2 ?? "").trim() === "")) && (
              <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                Skipped until you pick a value
              </span>
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
          Add a filter
        </Button>
      </div>
    </div>
  );
}
