import { addsUp } from "./grouping";

/**
 * A report with one field spread across the columns: a column for each day
 * of the week, each date of a month, or each pay code, each holding one
 * measure (paid hours) added up, as NovaTime's Daily Hours, Monthly Payroll
 * and Summary By PayCode reports lay them out.
 *
 * <p>The rows are combined by the other text columns shown (Employee, Week),
 * with the person's badge always part of it, so two people with one name
 * stay two rows. Other hours columns shown are added up beside the spread
 * ones; any other number keeps its first value.
 */

export interface AcrossSpec {
  /** The field whose values become columns. */
  field: string;
  /** The number added up under each of them. */
  value: string;
}

interface Column {
  id: string;
  label: string;
  type: string;
  exportLabel?: string;
  total?: boolean;
  groupOrder?: string;
}

const SHORT_DAY = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function spreadAcross(
  result: { columns: Column[]; rows: Record<string, unknown>[] },
  defColumns: Column[],
  spec: AcrossSpec
): { columns: Column[]; rows: Record<string, unknown>[] } | null {
  const across = defColumns.find((c) => c.id === spec.field);
  const value = defColumns.find((c) => c.id === spec.value && c.type === "number");
  if (!across || !value) return null;

  const keys = result.columns.filter((c) => c.type !== "number" && c.id !== across.id);
  const others = result.columns.filter((c) => c.type === "number" && c.id !== value.id);
  const blank = `No ${across.label.toLowerCase()}`;
  const valueOf = (row: Record<string, unknown>) => {
    const v = row[across.id];
    return v === null || v === undefined || String(v).trim() === "" ? blank : String(v).trim();
  };

  // The columns: every value that has something under it, in its own order.
  const seen = new Map<string, string>();
  for (const row of result.rows) {
    if (typeof row[value.id] !== "number") continue;
    const v = valueOf(row);
    if (!seen.has(v)) seen.set(v, across.groupOrder ? String(row[across.groupOrder] ?? "") : v);
  }
  // Dates run unbroken from the first to the last, so a month reads as a
  // calendar with a column for a day nobody worked.
  if (across.type === "date") {
    const days = [...seen.keys()].filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)).sort();
    for (let at = Date.parse(`${days[0]}T12:00:00Z`), end = Date.parse(`${days.at(-1)}T12:00:00Z`); days.length && at <= end; at += 86_400_000) {
      const day = new Date(at).toISOString().slice(0, 10);
      if (!seen.has(day)) seen.set(day, day);
    }
  }
  const values = [...seen.keys()].sort((a, b) => {
    if (a === blank || b === blank) return a === blank ? 1 : -1;
    return (seen.get(a) ?? a).localeCompare(seen.get(b) ?? b, "en-US", { numeric: true, sensitivity: "base" });
  });
  const columnOf = new Map(values.map((v, i) => [v, `a${i}_${value.id}`]));
  const totalId = `total_${value.id}`;

  // The rows, in the order each first appears.
  const out = new Map<string, Record<string, unknown>>();
  for (const row of result.rows) {
    const amount = row[value.id];
    if (typeof amount !== "number") continue;
    const key = JSON.stringify([...keys.map((c) => row[c.id] ?? null), row.employeeCode ?? null]);
    let line = out.get(key);
    if (!line) {
      line = { ...row, [totalId]: 0 };
      for (const id of columnOf.values()) line[id] = 0;
      for (const c of others) if (addsUp(c)) line[c.id] = 0;
      out.set(key, line);
    }
    const id = columnOf.get(valueOf(row))!;
    line[id] = (line[id] as number) + amount;
    line[totalId] = (line[totalId] as number) + amount;
    for (const c of others) {
      if (addsUp(c) && typeof row[c.id] === "number") line[c.id] = (line[c.id] as number) + (row[c.id] as number);
    }
  }

  const label = (v: string) => (across.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? SHORT_DAY(v) : v);
  return {
    columns: [
      ...keys,
      ...values.map((v) => ({ id: columnOf.get(v)!, label: label(v), type: "number", total: value.total })),
      // "Total paid hours", or just "Total" when the hours are already a total.
      { id: totalId, label: /^total\b/i.test(value.label) ? value.label : `Total ${value.label.toLowerCase()}`, type: "number", total: value.total },
      ...others,
    ],
    rows: [...out.values()],
  };
}
