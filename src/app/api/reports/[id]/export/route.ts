import { NextRequest, NextResponse } from "next/server";
import { getReportForExport } from "@/actions/report.actions";
import { generateCsv } from "@/lib/reports/export/csv";
import { generatePdf } from "@/lib/reports/export/pdf";
import { generateXlsx } from "@/lib/reports/export/xlsx";
import { reportFileStem } from "@/lib/reports/file-name";

/**
 * A saved report as a file: CSV, Excel or PDF.
 *
 * <p>Built on a server action that carries the permission check and the
 * report scope, as the other report downloads are: only a report you could
 * open on screen can be downloaded, and one you cannot answers 404, the same
 * as one that does not exist.
 *
 * <p>`range` (or `dateRange`, from the classic design) is the date range on
 * screen, as JSON. Without it the report's saved dates are used, which is
 * what a bookmarked link gets.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  if (!["csv", "pdf", "xlsx"].includes(format)) {
    return new NextResponse("Use csv, pdf or xlsx.", { status: 400 });
  }

  let dateRange: unknown;
  // `dateRange` is the classic design's name for the same value.
  const range = req.nextUrl.searchParams.get("range") ?? req.nextUrl.searchParams.get("dateRange");
  if (range) {
    try {
      dateRange = JSON.parse(range);
    } catch {
      return new NextResponse("The date range could not be read.", { status: 400 });
    }
  }

  const res = await getReportForExport({ id, dateRange });
  if (!res.success) {
    if (res.error === "UNAUTHENTICATED") return new NextResponse("Sign in to download this report.", { status: 401 });
    // Forbidden and not yours both read as not found, so a link does not
    // confirm that a report exists.
    return new NextResponse("Report not found", { status: 404 });
  }

  const { name, brand, result } = res.data;
  const safeName = reportFileStem(name, result, brand);

  if (format === "csv") {
    // Encoded explicitly (generateCsv leads with a byte order mark), so Excel
    // reads accented names as UTF-8 rather than guessing.
    return new NextResponse(new TextEncoder().encode(generateCsv(result)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}.csv"`,
      },
    });
  }
  if (format === "pdf") {
    const pdf = await generatePdf(result, name);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
      },
    });
  }
  const xlsx = await generateXlsx(result, name);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
    },
  });
}
