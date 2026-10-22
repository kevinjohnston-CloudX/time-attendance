"use client";

import { EmptyState, Table, TableFooter, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui";
import { Loader2, SearchX } from "lucide-react";
import { cellText } from "@/lib/reports/cell";
import type { ReportGroups } from "@/lib/reports/grouping";
import phone from "../reports-phone.module.css";

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
  groups,
  isLoading,
  fill = false,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  totalRows: number;
  /** The rows in their groups with totals, worked out with the report (grouping.ts). */
  groups?: ReportGroups;
  isLoading?: boolean;
  /** Fill a panel of fixed height: the rows scroll inside it under a pinned
   *  header, and the count stays at the bottom. */
  fill?: boolean;
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

  const grand = groups?.lines.find((l) => l.kind === "total");

  return (
    <div className={`${fill ? "flex min-h-0 flex-1 flex-col" : "contents"} ${phone.results}`}>
      <Table style={fill ? { flex: 1, minHeight: 0 } : undefined}>
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
          {groups
            ? groups.lines.map((line, i) => {
                if (line.kind === "row") return <DataRow key={i} row={rows[line.index]} columns={columns} />;
                if (line.kind === "group") return <GroupRow key={i} line={line} span={columns.length} />;
                if (line.kind === "subtotal")
                  return <TotalRow key={i} label={`Total for ${line.label}`} values={line.values} columns={columns} indent={line.level} />;
                return null;
              })
            : rows.map((row, i) => <DataRow key={i} row={row} columns={columns} />)}
        </TBody>
        {grand && (
          <TFoot>
            <TotalRow label="Grand total" values={grand.values} columns={columns} indent={0} />
          </TFoot>
        )}
      </Table>

      {/* A total short by the rows the limit left out is worse than none. */}
      {groups && !groups.totalsShown && groups.totalColumns.length > 0 && (
        <p style={{ margin: 0, padding: "8px 14px 0", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
          Totals are left out because only the first {rows.length.toLocaleString("en-US")} rows are shown.
        </p>
      )}

      {/* Rows returned against rows the query matched. A report capped at its
          row limit looks complete without this line, and a total that is short
          by the cap is a number somebody would put in a payroll email. */}
      <TableFooter
        shown={rows.length}
        total={totalRows}
        label={totalRows === 1 ? "row" : "rows"}
      />
    </div>
  );
}

function DataRow({ row, columns }: { row: Record<string, unknown>; columns: Column[] }) {
  return (
    <TR>
      {columns.map((col) => (
        // Numbers right-aligned with tabular figures: a report column of
        // hours is read down, and the decimal points have to line up for
        // that to be possible.
        <TD key={col.id} numeric={col.type === "number"} style={{ whiteSpace: "nowrap" }}>
          {formatCell(row[col.id], col.type, col.id)}
        </TD>
      ))}
    </TR>
  );
}

/** The start of a group: the field in quiet text, then the group's name. */
function GroupRow({ line, span }: { line: Extract<ReportGroups["lines"][number], { kind: "group" }>; span: number }) {
  return (
    <TR>
      <TD
        colSpan={span}
        style={{
          whiteSpace: "nowrap",
          paddingLeft: 14 + line.level * 20,
          background: line.level === 0 ? "var(--fill-hover)" : undefined,
          borderTop: line.level === 0 ? "1px solid var(--stroke-secondary)" : undefined,
        }}
      >
        <span style={{ color: "var(--text-secondary)", marginRight: 8 }}>{line.fieldLabel}</span>
        <span style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>{line.label}</span>
      </TD>
    </TR>
  );
}

/**
 * A total: its label in the first column, the sums under the columns that
 * add up, and nothing under the rest (a total of pay rates means nothing).
 */
function TotalRow({
  label,
  values,
  columns,
  indent,
}: {
  label: string;
  values: Record<string, number>;
  columns: Column[];
  indent: number;
}) {
  return (
    <TR>
      {columns.map((col, i) => {
        const has = col.id in values;
        return (
          <TD
            key={col.id}
            numeric={col.type === "number"}
            style={{
              whiteSpace: "nowrap",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)",
              ...(i === 0 ? { paddingLeft: 14 + indent * 20 } : {}),
            }}
          >
            {has ? cellText(values[col.id], col) || "0" : i === 0 ? label : ""}
          </TD>
        );
      })}
    </TR>
  );
}
