"use client";

import { EmptyState, Table, TableFooter, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui";
import { Loader2, SearchX } from "lucide-react";
import { cellText, displayText } from "@/lib/reports/cell";
import { signers, type ReportGroups, type Signature } from "@/lib/reports/grouping";
import phone from "../reports-phone.module.css";

interface Column {
  id: string;
  label: string;
  type: string;
}

/** A cell on screen: the shared formatting, with a dash for nothing. */
function formatCell(value: unknown, type: string, id: string): string {
  return displayText(value, { id, type }) || "—";
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
  cards = false,
  isLoading,
  fill = false,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  totalRows: number;
  /** The rows in their groups with totals, worked out with the report (grouping.ts). */
  groups?: ReportGroups;
  /** Each row as a card, its columns one under another, as it prints. */
  cards?: boolean;
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
        {!cards && (
          <THead>
            <TR>
              {columns.map((col) => (
                <TH key={col.id} numeric={col.type === "number"}>
                  {col.label}
                </TH>
              ))}
            </TR>
          </THead>
        )}
        <TBody>
          {groups
            ? groups.lines.map((line, i) => {
                if (line.kind === "row")
                  return cards ? (
                    <CardRow key={i} row={rows[line.index]} columns={columns} />
                  ) : (
                    <DataRow key={i} row={rows[line.index]} columns={columns} />
                  );
                if (line.kind === "group") return <GroupRow key={i} line={line} span={columns.length} />;
                if (line.kind === "subtotal")
                  return <TotalRow key={i} label={`Total for ${line.label}`} values={line.values} columns={columns} indent={line.level} />;
                if (line.kind === "signature") return <SignatureRow key={i} signature={line.signature} span={columns.length} />;
                return null;
              })
            : rows.map((row, i) =>
                cards ? <CardRow key={i} row={row} columns={columns} /> : <DataRow key={i} row={row} columns={columns} />
              )}
        </TBody>
        {grand && (
          <TFoot>
            <TotalRow label="Grand total" values={grand.values} columns={columns} indent={0} />
          </TFoot>
        )}
      </Table>

      {/* A total short by the rows the limit left out is worse than none. */}
      {groups && ((!groups.totalsShown && groups.totalColumns.length > 0) || groups.signaturesLeftOut) && (
        <p style={{ margin: 0, padding: "8px 14px 0", font: "var(--type-body2)", color: "var(--text-secondary)" }}>
          {!groups.totalsShown && groups.totalColumns.length > 0
            ? groups.signaturesLeftOut
              ? "Totals and signature lines"
              : "Totals"
            : "Signature lines"}{" "}
          are left out because only the first {rows.length.toLocaleString("en-US")} rows are shown.
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

/** A row as a card: each column's name over its value, filling the width. */
function CardRow({ row, columns }: { row: Record<string, unknown>; columns: Column[] }) {
  return (
    <TR>
      <TD colSpan={columns.length} style={{ padding: "14px 14px 16px" }}>
        <dl className="m-0 grid gap-x-6 gap-y-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {columns.map((col) => (
            <div key={col.id} className="flex min-w-0 flex-col gap-0.5">
              <dt style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{col.label}</dt>
              <dd className="m-0 truncate" style={{ font: "var(--type-body2)", color: "var(--text-primary)" }} title={formatCell(row[col.id], col.type, col.id)}>
                {formatCell(row[col.id], col.type, col.id)}
              </dd>
            </div>
          ))}
        </dl>
      </TD>
    </TR>
  );
}

/**
 * The start of a group: the field in quiet text, then the group's name. One
 * that starts a new printed page says so on the right, so the screen shows
 * where the PDF will turn the page.
 */
function GroupRow({ line, span }: { line: Extract<ReportGroups["lines"][number], { kind: "group" }>; span: number }) {
  const top = line.level === 0 || line.newPage;
  return (
    <TR>
      <TD
        colSpan={span}
        style={{
          whiteSpace: "nowrap",
          paddingLeft: 14 + line.level * 20,
          background: top ? "var(--fill-hover)" : undefined,
          borderTop: line.newPage ? "2px solid var(--stroke-default)" : top ? "1px solid var(--stroke-secondary)" : undefined,
        }}
      >
        <span className="flex items-baseline gap-2">
          <span style={{ color: "var(--text-secondary)" }}>{line.fieldLabel}</span>
          <span className="min-w-0 flex-1" style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
            {line.label}
          </span>
          {line.newPage && (
            <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>New page when printed</span>
          )}
        </span>
      </TD>
    </TR>
  );
}

/** The statement and the lines to sign, as they print under a page group or the report. */
function SignatureRow({ signature, span }: { signature: Signature; span: number }) {
  return (
    <TR>
      <TD colSpan={span} style={{ padding: "16px 14px 20px" }}>
        <div className="flex flex-col gap-5" style={{ maxWidth: 640 }}>
          {signature.text && (
            <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-primary)", whiteSpace: "normal" }}>
              {signature.text}
            </p>
          )}
          {signers(signature).map((who) => (
            <div key={who} className="flex gap-6">
              <SignLine label={who} width={280} />
              <SignLine label="Date" width={140} />
            </div>
          ))}
        </div>
      </TD>
    </TR>
  );
}

function SignLine({ label, width }: { label: string; width: number }) {
  return (
    <span className="flex flex-col gap-1" style={{ width }}>
      <span style={{ height: 22, borderBottom: "1px solid var(--stroke-default)" }} />
      <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>{label}</span>
    </span>
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
