"use client";

import { EmptyState, Table, TableFooter, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Loader2, SearchX } from "lucide-react";
import { cellText } from "@/lib/reports/cell";

interface Column {
  id: string;
  label: string;
  type: string;
}

/** A cell on screen: the shared formatting, with a dash for nothing. */
function formatCell(value: unknown, type: string, id: string): string {
  return cellText(value, { id, type }) || "—";
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
