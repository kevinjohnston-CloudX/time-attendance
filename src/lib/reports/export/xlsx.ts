import ExcelJS from "exceljs";
import type { ReportResult } from "../data-sources";
import { cellValue, isHoursColumn } from "../cell";

export async function generateXlsx(
  result: ReportResult,
  title: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CloudTime";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31)); // Excel max 31 chars

  // Header row
  // Hours as real numbers with two decimals, so a column can be summed.
  sheet.columns = result.columns.map((col) => ({
    header: col.exportLabel ?? col.label,
    key: col.id,
    width: col.type === "number" ? 12 : 20,
    ...(isHoursColumn(col) ? { style: { numFmt: "0.00" } } : {}),
  }));

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 10 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF4F4F5" },
  };

  const addData = (row: Record<string, unknown>) => {
    const values: Record<string, unknown> = {};
    for (const col of result.columns) {
      values[col.id] = cellValue(row[col.id], col) ?? "";
    }
    sheet.addRow(values);
  };
  // A total's label in the first column and its sums under the columns that
  // add up, as numbers, so Excel can check them.
  const addTotal = (label: string, sums: Record<string, number>, fill: string) => {
    const values: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      if (col.id in sums) values[col.id] = cellValue(sums[col.id], col) ?? 0;
      else if (i === 0) values[col.id] = label;
    });
    const r = sheet.addRow(values);
    r.font = { bold: true, size: 10 };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  };

  const groups = result.groups;
  if (!groups) {
    for (const row of result.rows) addData(row);
  } else {
    for (const line of groups.lines) {
      if (line.kind === "row") addData(result.rows[line.index]);
      else if (line.kind === "group") {
        const r = sheet.addRow({ [result.columns[0].id]: `${line.fieldLabel}: ${line.label}` });
        r.font = { bold: true, size: 10 };
      } else if (line.kind === "subtotal") addTotal(`Total for ${line.label}`, line.values, "FFFAFAFA");
      else addTotal("Grand total", line.values, "FFF4F4F5");
    }
  }

  // Auto-filter, on a plain list only: heading and total lines inside a
  // grouped sheet would be sorted in among the rows they sum.
  if (result.rows.length > 0 && !groups?.lines.some((l) => l.kind !== "row")) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: result.rows.length + 1, column: result.columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
