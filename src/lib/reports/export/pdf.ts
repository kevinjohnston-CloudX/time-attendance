import { cellText } from "../cell";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake");
import type { TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";
import type { ReportResult } from "../data-sources";

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

  const headers = result.columns.map((c) => ({
    text: c.label,
    bold: true,
    fontSize: 8,
    fillColor: "#f4f4f5",
  }));

  const cut = result.rows.length > MAX_PDF_ROWS;
  const align = (col: { type: string }) => (col.type === "number" ? "right" : "left") as "right" | "left";
  const dataRow = (row: Record<string, unknown>): TableCell[] =>
    result.columns.map((col) => ({ text: cellText(row[col.id], col), fontSize: 7, alignment: align(col) }));
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

  // Rows past the limit are left out, and so are the totals, which would be
  // short by them.
  const body: TableCell[][] = [];
  if (!result.groups) {
    for (const row of result.rows.slice(0, MAX_PDF_ROWS)) body.push(dataRow(row));
  } else {
    const lines = result.groups.lines;
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
        if (firstRowAfter(i) < MAX_PDF_ROWS) body.push(groupRow(`${line.fieldLabel}: ${line.label}`, line.level));
      } else if (cut) {
        return;
      } else if (line.kind === "subtotal") {
        body.push(totalRow(`Total for ${line.label}`, line.values, "#fafafa"));
      } else {
        body.push(totalRow("Grand total", line.values, "#f4f4f5"));
      }
    });
  }

  const docDefinition: TDocumentDefinitions = {
    defaultStyle: { font: "Helvetica" },
    pageOrientation: result.columns.length > 6 ? "landscape" : "portrait",
    pageSize: "LETTER",
    pageMargins: [30, 40, 30, 40],
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
      {
        table: {
          headerRows: 1,
          widths: result.columns.map(() => "*"),
          body: [headers, ...body],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => "#e4e4e7",
          vLineColor: () => "#e4e4e7",
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
    ],
  };

  return Buffer.from(await PdfPrinter.createPdf(docDefinition).getBuffer());
}
