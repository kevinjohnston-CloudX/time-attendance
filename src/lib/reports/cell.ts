/**
 * One report cell, the same on screen and in every download.
 *
 * <p>Durations are stored in minutes, and every duration column is named for
 * it (regMinutes, durationMinutes), so exactly those read as hours. Anything
 * else numeric stays as it is: a Year of 2026 is not 33.77 hours. Downloads
 * used to carry the raw minutes under a heading the screen showed as hours,
 * so 8.00 on screen was 480 in the spreadsheet.
 */

interface Column {
  id: string;
  type: string;
}

export function isHoursColumn(col: Column): boolean {
  return col.type === "number" && col.id.endsWith("Minutes");
}

/** The value for a spreadsheet cell: hours as a number, yes or no, or the text. */
export function cellValue(value: unknown, col: Column): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (col.type === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return isHoursColumn(col) ? Math.round((value / 60) * 100) / 100 : value;
  return String(value);
}

/** The value as text, for the screen, CSV and PDF. Empty is a dash on screen only. */
export function cellText(value: unknown, col: Column): string {
  const v = cellValue(value, col);
  if (v === null) return "";
  if (typeof v === "number" && isHoursColumn(col)) return v.toFixed(2);
  return String(v);
}

/**
 * The value as a person reads it, on screen and in the PDF: a day as
 * "Mon, Sep 28, 2026" for a day worked, or "Jul 10, 2023" for any other date.
 * The CSV and Excel files keep 2026-09-28, which sorts and imports as a date.
 */
export function displayText(value: unknown, col: Column): string {
  const text = cellText(value, col);
  if (col.type !== "date" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const at = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return text;
  return at.toLocaleDateString("en-US", {
    ...(col.id === "date" ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
