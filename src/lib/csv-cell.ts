/**
 * A value as a CSV cell for a file a person opens in Excel.
 *
 * <p>Text starting with = + - @ (or a tab or carriage return) is read by Excel
 * as a formula, and some columns carry text people type: leave and missed
 * punch notes, timecard notes, names. A note like =HYPERLINK(...) ran on the
 * machine of whoever opened the export. Such text gets a leading apostrophe,
 * which Excel shows as plain text without displaying it.
 *
 * <p>Numbers are left as they are, negative ones included ("-1.50"), so
 * totals still add up. Not for files a program reads, such as the ADP payroll
 * file, which must stay exactly as written.
 */
export function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const formula = typeof value !== "number" && /^[=+\-@\t\r]/.test(raw) && !/^[-+]?\d+(\.\d+)?$/.test(raw);
  const s = formula ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
