import { cellText, displayText } from "../cell";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake");
import type { Content, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";
import type { ReportResult } from "../data-sources";
import { signers, type Signature } from "../grouping";

const fonts: TFontDictionary = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

/**
 * A PDF is laid out on the web server in one go, so a very long one holds
 * everything else up while it is made. Past this many rows the PDF stops and
 * says so, and the CSV and Excel files carry every row.
 */
export const MAX_PDF_ROWS = 2000;

export async function generatePdf(
  result: ReportResult,
  title: string
): Promise<Buffer> {
  // pdfmake 0.3 has no printer class to construct: fonts are set on the module
  // and a document is made with createPdf. The old call threw "is not a
  // constructor", so a report could never be sent or downloaded as a PDF.
  PdfPrinter.setFonts(fonts);
  // A report holds no pictures or links to fetch, so nothing may be fetched.
  PdfPrinter.setUrlAccessPolicy(() => false);

  // Made afresh for each table: pdfmake marks the cells it lays out, and the
  // same ones handed to a second table printed as empty boxes.
  const headers = () =>
    result.columns.map((c) => ({
      text: c.label,
      bold: true,
      fontSize: 8,
      fillColor: "#f4f4f5",
    }));

  const cut = result.rows.length > MAX_PDF_ROWS;
  const align = (col: { type: string }) => (col.type === "number" ? "right" : "left") as "right" | "left";
  const dataRow = (row: Record<string, unknown>): TableCell[] =>
    result.columns.map((col) => ({ text: displayText(row[col.id], col), fontSize: 7, alignment: align(col) }));
  const totalRow = (label: string, sums: Record<string, number>, fill: string): TableCell[] =>
    result.columns.map((col, i) => ({
      text: col.id in sums ? cellText(sums[col.id], col) || "0" : i === 0 ? label : "",
      fontSize: 7,
      bold: true,
      fillColor: fill,
      alignment: align(col),
    }));
  // A group's heading runs the width of the table.
  const groupRow = (text: string, level: number): TableCell[] => [
    { text, fontSize: 8, bold: true, colSpan: result.columns.length, margin: [level * 8, 2, 0, 0] as [number, number, number, number], fillColor: level === 0 ? "#f4f4f5" : undefined },
    ...result.columns.slice(1).map(() => ({ text: "" })),
  ];

  const tableLayout = {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => "#e4e4e7",
    vLineColor: () => "#e4e4e7",
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: () => 3,
    paddingBottom: () => 3,
  };

  // The rows go into one table per printed page group, each with the
  // headings again, and a signature block may close any of them.
  const blocks: Content[] = [];
  let body: TableCell[][] = [];
  let breakBefore = false;
  const flush = () => {
    if (body.length === 0) return;
    blocks.push({
      table: { headerRows: 1, widths: result.columns.map(() => "*"), body: [headers(), ...body] },
      layout: tableLayout,
      ...(breakBefore ? { pageBreak: "before" as const } : {}),
    });
    body = [];
    breakBefore = false;
  };
  const signatureBlock = (signature: Signature): Content => ({
    unbreakable: true,
    margin: [0, 14, 0, 6],
    stack: [
      ...(signature.text ? [{ text: signature.text, fontSize: 9, margin: [0, 0, 0, 22] as [number, number, number, number] }] : []),
      ...signers(signature).map((who) => ({
        margin: [0, 0, 0, 20] as [number, number, number, number],
        columns: [
          { width: 260, stack: [{ canvas: [{ type: "line" as const, x1: 0, y1: 0, x2: 250, y2: 0, lineWidth: 0.5 }] }, { text: who, fontSize: 8, color: "#52525b", margin: [0, 3, 0, 0] as [number, number, number, number] }] },
          { width: 140, stack: [{ canvas: [{ type: "line" as const, x1: 0, y1: 0, x2: 130, y2: 0, lineWidth: 0.5 }] }, { text: "Date", fontSize: 8, color: "#52525b", margin: [0, 3, 0, 0] as [number, number, number, number] }] },
        ],
      })),
    ],
  });

  // Rows past the limit are left out, and so are the totals, which would be
  // short by them, and the signatures, which would sign for rows not shown.
  if (!result.groups) {
    for (const row of result.rows.slice(0, MAX_PDF_ROWS)) body.push(dataRow(row));
  } else {
    const lines = result.groups.lines;
    const pagedGroups = lines.some((l) => l.kind === "group" && l.newPage);
    // A group heading is kept when its first row made it in.
    const firstRowAfter = (i: number) => {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.kind === "row") return l.index;
      }
      return Infinity;
    };
    lines.forEach((line, i) => {
      if (line.kind === "row") {
        if (line.index < MAX_PDF_ROWS) body.push(dataRow(result.rows[line.index]));
      } else if (line.kind === "group") {
        if (firstRowAfter(i) >= MAX_PDF_ROWS) return;
        if (line.newPage) {
          flush();
          breakBefore = true;
        }
        body.push(groupRow(`${line.fieldLabel}: ${line.label}`, line.level));
      } else if (cut) {
        return;
      } else if (line.kind === "subtotal") {
        body.push(totalRow(`Total for ${line.label}`, line.values, "#fafafa"));
      } else if (line.kind === "total") {
        // Printed a page per group, the grand total gets a page of its own,
        // or it reads as the last person's under their signature.
        if (pagedGroups) {
          flush();
          breakBefore = true;
        }
        body.push(totalRow("Grand total", line.values, "#f4f4f5"));
      } else {
        // A page break still waiting for its first row carries over the signature.
        const pending = body.length === 0 && breakBefore;
        flush();
        blocks.push(signatureBlock(line.signature));
        breakBefore = pending;
      }
    });
  }
  flush();

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: "Helvetica" },
    pageOrientation: result.columns.length > 6 ? "landscape" : "portrait",
    pageSize: "LETTER",
    pageMargins: [30, 40, 30, 40],
    // Every page after the first says what it is, so a printed stack of
    // timesheets can be told apart, and how far through it is.
    header: (page: number, pages: number) =>
      page === 1
        ? null
        : {
            text: `${title}${result.period ? ` · ${result.period.label}` : ""} · Page ${page} of ${pages}`,
            fontSize: 7,
            color: "#71717a",
            margin: [30, 20, 30, 0],
          },
    content: [
      { text: title, fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
      {
        text: `${result.period ? `${result.period.label} · ` : ""}${result.totalRows.toLocaleString("en-US")} ${result.totalRows === 1 ? "row" : "rows"} · Made ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
        fontSize: 8,
        color: "#71717a",
        margin: [0, 0, 0, cut ? 2 : 12],
      },
      ...(cut
        ? [{
            text: `Showing the first ${MAX_PDF_ROWS.toLocaleString("en-US")} rows. Download CSV or Excel to get all of them.`,
            fontSize: 8,
            color: "#71717a",
            margin: [0, 0, 0, 12] as [number, number, number, number],
          }]
        : []),
      ...blocks,
    ],
  };

  return Buffer.from(await PdfPrinter.createPdf(docDefinition).getBuffer());
}
