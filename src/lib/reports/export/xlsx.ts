import ExcelJS from "exceljs";
import type { ReportResult } from "../data-sources";
import { cellValue, isHoursColumn, isMoneyColumn } from "../cell";
import { signers, type Signature } from "../grouping";

export async function generateXlsx(
  result: ReportResult,
  title: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CloudTime";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31)); // Excel max 31 chars

  // A report that asks for it opens with its name and dates, then a blank
  // line, above the headings (a payroll report is filed as it is).
  const titled = result.titleRows && result.period ? result.period : null;

  // Header row
  // Hours as real numbers with two decimals, so a column can be summed.
  sheet.columns = result.columns.map((col) => ({
    header: titled ? undefined : col.exportLabel ?? col.label,
    key: col.id,
    width: col.type === "number" ? 12 : 20,
    ...(isHoursColumn(col) ? { style: { numFmt: "0.00" } } : isMoneyColumn(col) ? { style: { numFmt: '"$"#,##0.00' } } : {}),
  }));
  let headerAt = 1;
  if (titled) {
    sheet.addRow([title]).font = { bold: true, size: 13 };
    sheet.addRow([titled.label]).font = { size: 11 };
    sheet.addRow([]);
    headerAt = sheet.addRow(result.columns.map((col) => col.exportLabel ?? col.label)).number;
  }

  // Style header row
  const headerRow = sheet.getRow(headerAt);
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

  // The statement across the sheet, then a line to sign and one to date
  // for each signer, the way the PDF prints them.
  const last = result.columns.length;
  const addSignature = (signature: Signature) => {
    sheet.addRow([]);
    if (signature.text) {
      const r = sheet.addRow([signature.text]);
      sheet.mergeCells(r.number, 1, r.number, Math.max(1, last));
      r.alignment = { wrapText: true, vertical: "top" };
      r.height = 30;
      sheet.addRow([]);
    }
    for (const who of signers(signature)) {
      const r = sheet.addRow([]);
      r.height = 28;
      const line = { bottom: { style: "thin" as const } };
      const sign = r.getCell(1);
      sign.border = line;
      const date = r.getCell(Math.min(last, 3));
      if (date.col !== sign.col) date.border = line;
      const caption = sheet.addRow([]);
      caption.getCell(1).value = who;
      if (date.col !== sign.col) caption.getCell(date.col).value = "Date";
      caption.font = { size: 9, color: { argb: "FF52525B" } };
    }
  };

  const groups = result.groups;
  if (!groups) {
    for (const row of result.rows) addData(row);
  } else {
    for (const line of groups.lines) {
      if (line.kind === "row") addData(result.rows[line.index]);
      else if (line.kind === "group") {
        // A printed page per group: the break goes under the last line of the one before.
        if (line.newPage) sheet.lastRow?.addPageBreak();
        const r = sheet.addRow({ [result.columns[0].id]: `${line.fieldLabel}: ${line.label}` });
        r.font = { bold: true, size: 10 };
      } else if (line.kind === "subtotal") addTotal(`Total for ${line.label}`, line.values, "FFFAFAFA");
      else if (line.kind === "total") {
        // A page per group: the grand total on a page of its own, as in the PDF.
        if (groups.lines.some((l) => l.kind === "group" && l.newPage)) sheet.lastRow?.addPageBreak();
        addTotal("Grand total", line.values, "FFF4F4F5");
      }
      else addSignature(line.signature);
    }
  }

  // Auto-filter, on a plain list only: heading and total lines inside a
  // grouped sheet would be sorted in among the rows they sum.
  if (result.rows.length > 0 && !groups?.lines.some((l) => l.kind !== "row")) {
    sheet.autoFilter = {
      from: { row: headerAt, column: 1 },
      to: { row: result.rows.length + headerAt, column: result.columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
