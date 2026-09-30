import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { db } from "@/lib/db";
import { getDataSource } from "@/lib/reports/data-sources";
import { reportConfigSchema, dateRangeSchema, type DataSourceId } from "@/lib/validators/report.schema";
import { generateCsv } from "@/lib/reports/export/csv";
import { generatePdf } from "@/lib/reports/export/pdf";
import { generateXlsx } from "@/lib/reports/export/xlsx";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!hasPermission(session.user.role, "REPORT_MANAGE")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const dateRangeParam = req.nextUrl.searchParams.get("dateRange");

  const report = await db.reportDefinition.findFirst({
    where: { id },
  });
  if (!report) {
    return new NextResponse("Report not found", { status: 404 });
  }

  let config = reportConfigSchema.parse(report.config);

  if (dateRangeParam) {
    try {
      const parsedRange = dateRangeSchema.parse(JSON.parse(dateRangeParam));
      config = { ...config, dateRange: parsedRange };
    } catch {
      // ignore malformed dateRange param — fall back to saved config
    }
  }

  const source = getDataSource(report.dataSource as DataSourceId);
  const tenantId = report.tenantId;

  const result = await source.execute(config, tenantId);

  const safeName = report.name.replace(/[^a-z0-9]/gi, "-");

  switch (format) {
    case "csv": {
      const csv = generateCsv(result);
      const bytes = new TextEncoder().encode(csv);
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeName}.csv"`,
        },
      });
    }
    case "pdf": {
      const pdf = await generatePdf(result, report.name);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
        },
      });
    }
    case "xlsx": {
      const xlsx = await generateXlsx(result, report.name);
      return new NextResponse(new Uint8Array(xlsx), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
        },
      });
    }
    default:
      return new NextResponse("Invalid format. Use csv, pdf, or xlsx.", {
        status: 400,
      });
  }
}
