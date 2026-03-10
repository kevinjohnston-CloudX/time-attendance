import ExcelJS from "exceljs";
import type { ReportResult } from "../data-sources";

export async function generateXlsx(
  result: ReportResult,
  title: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Time & Attendance";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31)); // Excel max 31 chars

  // Header row
  sheet.columns = result.columns.map((col) => ({
    header: col.label,
    key: col.id,
    width: col.type === "number" ? 12 : 20,
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 10 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF4F4F5" },
  };

  // Data rows
  for (const row of result.rows) {
    const values: Record<string, unknown> = {};
    for (const col of result.columns) {
      values[col.id] = row[col.id] ?? "";
    }
    sheet.addRow(values);
  }

  // Auto-filter
  if (result.rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: result.rows.length + 1, column: result.columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
