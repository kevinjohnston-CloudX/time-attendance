"use client";

import { EmptyState, Table, TableFooter, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Loader2, SearchX } from "lucide-react";

interface Column {
  id: string;
  label: string;
  type: string;
}

function formatMinutesDecimal(mins: number): string {
  return (mins / 60).toFixed(2);
}

/**
 * One cell as a person reads it. Durations are stored in minutes and every
 * one of them is named for it (regMinutes, durationMinutes), so only those
 * turn into hours: a Year of 2026 used to come out as 33.77.
 */
function formatCell(value: unknown, type: string, id: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "number" && typeof value === "number") {
    if (id.endsWith("Minutes")) return formatMinutesDecimal(value);
    return String(value);
  }
  return String(value);
}

/**
 * The rows a report produced.
 *
 * <p>Renders the table and its count and nothing else — no panel, no heading.
 * Both callers put it inside a `Card padding={0}`, and a component that
 * brought its own surface would sit a second elevation inside the first.
 */
export function ResultsTable({
  columns,
  rows,
  totalRows,
  isLoading,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  totalRows: number;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <EmptyState icon={<Loader2 className="h-8 w-8 animate-spin" />} title="Running the report" />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" />}
        title="Nothing to show"
        body="No one matches these dates and filters. Try a wider date range, or remove a filter."
      />
    );
  }

  return (
    <>
      <Table>
        <THead>
          <TR>
            {columns.map((col) => (
              <TH key={col.id} numeric={col.type === "number"}>
                {col.label}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((row, i) => (
            <TR key={i}>
              {columns.map((col) => (
                // Numbers right-aligned with tabular figures: a report column
                // of hours is read down, and the decimal points have to line
                // up for that to be possible.
                <TD key={col.id} numeric={col.type === "number"} style={{ whiteSpace: "nowrap" }}>
                  {formatCell(row[col.id], col.type, col.id)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>

      {/* Rows returned against rows the query matched. A report capped at its
          row limit looks complete without this line, and a total that is short
          by the cap is a number somebody would put in a payroll email. */}
      <TableFooter
        shown={rows.length}
        total={totalRows}
        label={totalRows === 1 ? "row" : "rows"}
      />
    </>
  );
}
