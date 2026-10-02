import { cellText } from "../cell";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake");
import type { TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";
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

  const shownRows = result.rows.slice(0, MAX_PDF_ROWS);
  const cut = result.rows.length > MAX_PDF_ROWS;
  const body = shownRows.map((row) =>
    result.columns.map((col) => {
      return {
        text: cellText(row[col.id], col),
        fontSize: 7,
        alignment: (col.type === "number" ? "right" : "left") as "right" | "left",
      };
    })
  );

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
