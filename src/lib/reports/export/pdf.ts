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

export async function generatePdf(
  result: ReportResult,
  title: string
): Promise<Buffer> {
  const printer = new PdfPrinter(fonts);

  const headers = result.columns.map((c) => ({
    text: c.label,
    bold: true,
    fontSize: 8,
    fillColor: "#f4f4f5",
  }));

  const body = result.rows.map((row) =>
    result.columns.map((col) => {
      const val = row[col.id];
      return {
        text: val === null || val === undefined ? "" : String(val),
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
        text: `${result.totalRows} rows · Generated ${new Date().toLocaleString()}`,
        fontSize: 8,
        color: "#71717a",
        margin: [0, 0, 0, 12],
      },
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

  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDefinition);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
