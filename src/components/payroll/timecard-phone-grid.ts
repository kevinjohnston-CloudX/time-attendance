import { PHONE_QUERY } from "@/lib/phone";

/**
 * The Timecards day grid on a phone: each day as a short block rather than a
 * row of up to thirteen columns.
 *
 * <p>Written as a stylesheet built from the columns the grid actually has,
 * because which columns exist depends on the tenant (pay codes, reason codes,
 * a meal column, a delete column), and a cell is found by its position in its
 * row. Every row type keeps the desktop's cell order, which the desktop table
 * already relies on to line its columns up, so a position is a column.
 */

export type GridColumn =
  | "chev"
  | "day"
  | "in"
  | "out"
  | "reg"
  | "ot"
  | "dt"
  | "total"
  | "meal"
  | "pay"
  | "reason"
  | "notes"
  | "del";

/**
 * What each block shows, row by row, per kind of row (data-row on the tr), on
 * four equal tracks and a narrow fifth for the icons (timecard.module.css).
 */
const AREAS: Record<string, string[]> = {
  // A day: its date and total, the two punches, the hours, then the pickers.
  day: [
    "day day total total chev",
    "in in out out notes",
    "reg ot dt meal del",
    "pay pay reason reason .",
  ],
  // A second pair of punches on the same day.
  more: ["day day total total chev", "in in out out notes", "pay pay pay pay del"],
  // Time off on the day, and a meal premium: a label, the hours, the code.
  leave: ["day day total total chev", "pay pay pay pay ."],
  premium: ["day day total total chev", "meal meal pay pay ."],
};

/** The caption over a cell, where the cell alone does not say what it is. */
const LABEL: Partial<Record<GridColumn, string>> = {
  in: "Clock in",
  out: "Clock out",
  reg: "Regular",
  ot: "Overtime",
  dt: "Double",
  meal: "Meal break",
  pay: "Pay code",
  reason: "Reason",
};

export function phoneGridCss(table: string, columns: GridColumn[]): string {
  const rules: string[] = [];
  for (const [row, areas] of Object.entries(AREAS)) {
    const named = new Set(areas.join(" ").split(/\s+/));
    rules.push(`.${table} tr[data-row="${row}"]{grid-template-areas:${areas.map((a) => `"${a}"`).join(" ")}}`);
    columns.forEach((col, i) => {
      const cell = `.${table} tr[data-row="${row}"]>td:nth-child(${i + 1})`;
      if (!named.has(col)) {
        rules.push(`${cell}{display:none}`);
        return;
      }
      rules.push(`${cell}{grid-area:${col}}`);
      const label = LABEL[col];
      if (label) rules.push(`${cell}:not(:empty)::before{content:"${label}"}`);
    });
  }
  // Only the rows laid out as blocks: a week label or an open form is one
  // cell across the whole width, and these would pull it to one side.
  const blocks = Object.keys(AREAS).map((row) => `.${table} tr[data-row="${row}"]`);
  const each = (i: number, rest: string) => blocks.map((b) => `${b}>td:nth-child(${i + 1})${rest}`).join(",");
  columns.forEach((col, i) => {
    // The punch times are the thing a phone taps, so they look like fields.
    if (col === "in" || col === "out") {
      rules.push(`${each(i, ">button")}{display:flex;width:100%;min-height:40px;align-items:center;padding:0 10px!important;border:1px solid var(--stroke-secondary)!important;border-radius:10px!important}`);
    }
    if (col === "total") {
      rules.push(`${each(i, "")}{justify-self:end;font-weight:var(--weight-semibold)!important}`);
    }
    if (col === "chev" || col === "notes" || col === "del") {
      rules.push(`${each(i, "")}{justify-self:end;align-self:center}`);
    }
  });
  return `@media ${PHONE_QUERY}{${rules.join("")}}`;
}
