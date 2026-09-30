import type { ReportResult } from "../data-sources";
import { cellText } from "../cell";

export function generateCsv(result: ReportResult): string {
  const headers = result.columns.map((c) => escapeCsvField(c.label));
  const rows = result.rows.map((row) =>
    result.columns.map((col) => {
      return escapeCsvField(cellText(row[col.id], col));
    })
  );

  return "﻿" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
