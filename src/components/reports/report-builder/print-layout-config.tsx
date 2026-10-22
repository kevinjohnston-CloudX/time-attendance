"use client";

import { Checkbox, Select, Textarea } from "@/components/ui";
import type { PrintLayout } from "@/lib/reports/grouping";

/** NovaTime's own statement on its timesheets, in sentence case. */
export const DEFAULT_STATEMENT = "I certify the above information to be correct.";

/**
 * How the report prints: a new page for each group of one grouped field (a
 * timesheet per employee), and a statement with lines to sign. The screen,
 * the PDF and the Excel file all show both in the same places.
 */
export function PrintLayoutConfig({
  groupFields,
  layout,
  onChange,
}: {
  /** The fields the rows are grouped by, outermost first. */
  groupFields: { id: string; label: string }[];
  layout: PrintLayout;
  onChange: (layout: PrintLayout) => void;
}) {
  const pageBreak = groupFields.some((g) => g.id === layout.pageBreak) ? layout.pageBreak : "";
  const signature = layout.signature;

  return (
    <div className="flex flex-col gap-2">
      <span style={{ font: "var(--type-body2)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
        Print
      </span>

      <label className="flex flex-col gap-1.5">
        <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>New page for each</span>
        <Select
          value={pageBreak}
          disabled={groupFields.length === 0}
          onChange={(e) => onChange({ ...layout, pageBreak: e.target.value || undefined })}
          aria-label="New page for each"
        >
          <option value="">No new pages</option>
          {groupFields.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </Select>
        {groupFields.length === 0 && (
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            Group the rows first, for example by Employee, to start a page for each.
          </span>
        )}
      </label>

      <div className="flex flex-col gap-1 pt-1.5">
        <Checkbox
          checked={!!layout.cards}
          onChange={(on) => onChange({ ...layout, cards: on || undefined })}
          label="Show each row as a card"
        />
        <span className="pl-7" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
          Each row&rsquo;s columns listed one under another, like a profile.
        </span>
      </div>

      <div className="pt-1.5">
        <Checkbox
          checked={!!signature}
          onChange={(on) =>
            onChange({
              ...layout,
              signature: on ? { text: DEFAULT_STATEMENT, employee: true, supervisor: true } : undefined,
            })
          }
          label="Signature lines"
        />
      </div>

      {signature && (
        <div className="flex flex-col gap-2.5 pl-7">
          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
            {pageBreak ? "Printed at the end of each page group." : "Printed once, at the end of the report."}
          </span>
          <Textarea
            label="Statement"
            rows={2}
            maxLength={600}
            value={signature.text}
            onChange={(e) => onChange({ ...layout, signature: { ...signature, text: e.target.value } })}
          />
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Checkbox
              checked={signature.employee}
              onChange={(on) => onChange({ ...layout, signature: { ...signature, employee: on } })}
              label="Employee signs"
            />
            <Checkbox
              checked={signature.supervisor}
              onChange={(on) => onChange({ ...layout, signature: { ...signature, supervisor: on } })}
              label="Supervisor signs"
            />
          </div>
        </div>
      )}
    </div>
  );
}
