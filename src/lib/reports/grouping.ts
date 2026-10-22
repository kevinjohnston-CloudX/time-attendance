import { isHoursColumn } from "./cell";

/**
 * A report's rows in groups, with a total under each group and a grand total
 * at the end, the way NovaTime lays out a report grouped by Location, then
 * Department.
 *
 * <p>Worked out once, on the server, after the report has run, so the screen,
 * the Excel and PDF files and a scheduled email all show the same groups and
 * the same totals.
 *
 * <p>A total is only drawn when every row is in: a report cut at its row
 * limit would otherwise print a total short by the rows it left out, and a
 * total is the number somebody copies into a payroll email.
 *
 * <p>A printed report can also start a new page for each group (a timesheet
 * per employee) and close each one with a statement and signature lines, as
 * NovaTime's timesheets do. Where those fall is worked out here too, so the
 * screen, the PDF and the Excel file put them in the same places.
 */

export interface GroupColumn {
  id: string;
  label: string;
  type: string;
  /** Adds up in a total. Hours columns always do; others say so. */
  total?: boolean;
  /** Groups on this column are put in the order of another row field (a week by its first day). */
  groupOrder?: string;
}

/** A statement to sign, and who signs it, under each page group or the report. */
export interface Signature {
  text: string;
  employee: boolean;
  supervisor: boolean;
}

/** The lines to sign, in order: "Employee signature", then "Supervisor signature". */
export function signers(signature: Signature): string[] {
  return [signature.employee && "Employee signature", signature.supervisor && "Supervisor signature"].filter(
    (s): s is string => !!s
  );
}

/**
 * How a report prints, in a sentence: "A page for each employee, with lines
 * for the employee and supervisor to sign." Null when it prints as a list.
 */
export function describePrint(layout: PrintLayout | undefined, labelOf: (id: string) => string): string | null {
  const parts: string[] = [];
  if (layout?.cards) parts.push("Each row as a card");
  if (layout?.pageBreak) parts.push(`${parts.length ? "a" : "A"} page for each ${labelOf(layout.pageBreak).toLowerCase()}`);
  const who = layout?.signature ? signers(layout.signature).map((s) => s.replace(" signature", "").toLowerCase()) : [];
  if (layout?.signature) {
    const whom = who.length ? ` for the ${who.join(" and ")} to sign` : "";
    parts.push(parts.length ? `with signature lines${whom}` : `Signature lines${whom}`);
  }
  return parts.length ? `${parts.join(", ")}.` : null;
}

/** How a report is printed: a new page per group, and signature lines. */
export interface PrintLayout {
  /** The grouped field each new page starts at. */
  pageBreak?: string;
  /** Each row as a card, its columns one under another (an employee profile). */
  cards?: boolean;
  signature?: Signature;
}

export type ReportLine =
  /** The start of a group: "Packing", under "Department". On a new page when `newPage`. */
  | { kind: "group"; level: number; field: string; fieldLabel: string; label: string; newPage?: boolean }
  /** One of the report's rows, by its place in `rows`. */
  | { kind: "row"; index: number }
  /** The total of the group just closed. */
  | { kind: "subtotal"; level: number; label: string; values: Record<string, number> }
  /** Every row added up. */
  | { kind: "total"; values: Record<string, number> }
  /** The statement and signature lines, closing a page group or the report. */
  | { kind: "signature"; signature: Signature };

export interface ReportGroups {
  /** The fields the rows are grouped by, outermost first. */
  by: { id: string; label: string }[];
  lines: ReportLine[];
  /** False when the report stopped at its row limit, so no total is drawn. */
  totalsShown: boolean;
  /** The columns that have a total, in the order they are shown. */
  totalColumns: string[];
  /** Signature lines were asked for, but the report stopped at its row limit. */
  signaturesLeftOut?: boolean;
}

/** Whether a column adds up: hours, and the numbers a report marks as totals. */
export function addsUp(col: GroupColumn): boolean {
  return isHoursColumn(col) || (col.type === "number" && col.total === true);
}

function keyOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * What a row is grouped under. An employee is their name with their badge,
 * so two people with one name never share a group, or a printed timesheet.
 */
function groupKey(row: Record<string, unknown>, field: string): string {
  const key = keyOf(row[field]);
  if (field === "employeeName" && key) {
    const badge = keyOf(row.employeeCode);
    if (badge) return `${key} (${badge})`;
  }
  return key;
}

function blankLabel(fieldLabel: string): string {
  return `No ${fieldLabel.toLowerCase()}`;
}

/**
 * Adds a column up the way a person checking it would: hours as they are
 * shown, to two decimals, row by row. Adding the exact minutes instead gives
 * a total a cent off the column above it (132.63 under 66.77 and 65.87), in
 * the same file where Excel's own sum says 132.64. Hours come back in
 * minutes, as every hours value in a report is kept.
 */
function sum(rows: Record<string, unknown>[], indexes: number[], cols: GroupColumn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const col of cols) {
    const hours = isHoursColumn(col);
    let cents = 0;
    for (const i of indexes) {
      const v = rows[i][col.id];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      cents += Math.round((hours ? v / 60 : v) * 100);
    }
    out[col.id] = hours ? (cents / 100) * 60 : cents / 100;
  }
  return out;
}

/**
 * Sorts the rows into their groups (keeping the report's own order inside a
 * group) and lists the lines to draw. Returns the sorted rows with the lines,
 * or null when there is nothing to group and nothing to total.
 */
export function groupRows(
  rows: Record<string, unknown>[],
  columns: GroupColumn[],
  groupBy: string[],
  opts: {
    complete: boolean;
    fieldLabels?: Record<string, string>;
    /** Where groups order by another field, by group field. */
    groupOrder?: Record<string, string>;
    layout?: PrintLayout;
  }
): { rows: Record<string, unknown>[]; groups: ReportGroups } | null {
  const labelOf = (id: string) => opts.fieldLabels?.[id] ?? columns.find((c) => c.id === id)?.label ?? id;
  const by = groupBy
    .filter((id, i) => id && groupBy.indexOf(id) === i)
    .map((id) => ({ id, label: labelOf(id), order: opts.groupOrder?.[id] }));
  const adding = columns.filter(addsUp);
  const totalColumns = adding.map((c) => c.id);
  // A signature, like a total, is only drawn under every row: signing a page
  // cut short at the row limit would sign for hours that are not on it.
  const signature = opts.complete ? opts.layout?.signature : undefined;
  // A new page per group only means something for a field the rows are grouped by.
  const breakLevel = by.findIndex((g) => g.id === opts.layout?.pageBreak);
  if (by.length === 0 && totalColumns.length === 0 && !signature) return null;
  if (rows.length === 0) return null;
  // A total that would be cut short is not drawn, and with no groups either
  // there is nothing left to lay out, unless there is something to sign.
  if (by.length === 0 && !opts.complete && !signature) return null;

  // Groups in name order, blanks last; the report's own order inside a group.
  const order = rows.map((_, i) => i);
  if (by.length > 0) {
    order.sort((a, b) => {
      for (const g of by) {
        const ka = groupKey(rows[a], g.id);
        const kb = groupKey(rows[b], g.id);
        if (ka === kb) continue;
        if (!ka) return 1;
        if (!kb) return -1;
        // A week is ordered by its first day, not by its name.
        const oa = g.order ? keyOf(rows[a][g.order]) : ka;
        const ob = g.order ? keyOf(rows[b][g.order]) : kb;
        return (oa === ob ? ka : oa).localeCompare(oa === ob ? kb : ob, "en-US", { sensitivity: "base", numeric: true });
      }
      return a - b;
    });
  }
  const sorted = order.map((i) => rows[i]);
  const lines: ReportLine[] = [];
  const totalsShown = opts.complete && totalColumns.length > 0;

  // Walk the sorted rows, opening and closing groups as their keys change.
  const open: { key: string; label: string; start: number }[] = [];
  const close = (level: number, end: number) => {
    const g = open[level];
    if (totalsShown) {
      const idx = Array.from({ length: end - g.start }, (_, k) => g.start + k);
      lines.push({ kind: "subtotal", level, label: g.label, values: sum(sorted, idx, adding) });
    }
    // Each page group is signed under its own total.
    if (signature && level === breakLevel) lines.push({ kind: "signature", signature });
  };

  sorted.forEach((row, i) => {
    // The first level whose key differs from the open group's.
    let changed = open.length;
    for (let level = 0; level < by.length; level++) {
      if (level >= open.length || open[level].key !== groupKey(row, by[level].id)) {
        changed = level;
        break;
      }
    }
    if (changed < by.length) {
      for (let level = open.length - 1; level >= changed; level--) close(level, i);
      open.length = changed;
      // A new page where a group at or above the page level starts, except
      // the very first, which is on the first page already.
      const newPage = i > 0 && breakLevel >= 0 && changed <= breakLevel;
      for (let level = changed; level < by.length; level++) {
        const key = groupKey(row, by[level].id);
        const label = key || blankLabel(by[level].label);
        open.push({ key, label, start: i });
        lines.push({
          kind: "group",
          level,
          field: by[level].id,
          fieldLabel: by[level].label,
          label,
          ...(newPage && level === changed ? { newPage: true } : {}),
        });
      }
    }
    lines.push({ kind: "row", index: i });
  });
  for (let level = open.length - 1; level >= 0; level--) close(level, sorted.length);

  if (totalsShown) {
    lines.push({ kind: "total", values: sum(sorted, sorted.map((_, i) => i), adding) });
  }
  // With no page groups, the report is signed once, at its end.
  if (signature && breakLevel < 0) lines.push({ kind: "signature", signature });

  const signaturesLeftOut = !!opts.layout?.signature && !signature;
  return { rows: sorted, groups: { by, lines, totalsShown, totalColumns, ...(signaturesLeftOut ? { signaturesLeftOut } : {}) } };
}
