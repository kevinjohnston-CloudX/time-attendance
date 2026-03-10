import type { ReportResult } from "../data-sources";

export function generateCsv(result: ReportResult): string {
  const headers = result.columns.map((c) => escapeCsvField(c.label));
  const rows = result.rows.map((row) =>
    result.columns.map((col) => {
      const val = row[col.id];
      if (val === null || val === undefined) return "";
      return escapeCsvField(String(val));
    })
  );

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
