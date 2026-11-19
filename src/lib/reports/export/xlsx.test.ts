import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { generateXlsx } from "./xlsx";
import type { ReportResult } from "../data-sources";

const base: ReportResult = {
  columns: [
    { id: "employeeName", label: "Employee", type: "string" },
    { id: "regMinutes", label: "Regular", type: "number" },
  ],
  rows: [{ employeeName: "Acquah, Moses", regMinutes: 960 }],
  totalRows: 1,
  period: { start: "2026-11-01", end: "2026-11-07", label: "Pay period Nov 1 to Nov 7, 2026" },
};

async function read(result: ReportResult) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await generateXlsx(result, "Agency payroll backup"));
  const sheet = book.worksheets[0];
  return { sheet, cells: (row: number) => [1, 2].map((c) => sheet.getRow(row).getCell(c).value) };
}

describe("generateXlsx", () => {
  it("starts with the headings when the report does not ask for a title", async () => {
    const { cells } = await read(base);
    expect(cells(1)).toEqual(["Employee", "Regular"]);
    expect(cells(2)).toEqual(["Acquah, Moses", 16]);
  });

  it("puts the report's name and pay period above the headings when it asks", async () => {
    const { sheet, cells } = await read({ ...base, titleRows: true });
    expect(cells(1)[0]).toBe("Agency payroll backup");
    expect(cells(2)[0]).toBe("Pay period Nov 1 to Nov 7, 2026");
    expect(cells(4)).toEqual(["Employee", "Regular"]);
    expect(cells(5)).toEqual(["Acquah, Moses", 16]);
    expect(sheet.getRow(4).font?.bold).toBe(true);
  });
});
