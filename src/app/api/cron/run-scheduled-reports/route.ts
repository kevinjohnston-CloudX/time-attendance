import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDataSource } from "@/lib/reports/data-sources";
import { reportConfigSchema, type DataSourceId } from "@/lib/validators/report.schema";
import { generateCsv } from "@/lib/reports/export/csv";
import { generatePdf } from "@/lib/reports/export/pdf";
import { generateXlsx } from "@/lib/reports/export/xlsx";
import { sendReportEmail } from "@/lib/reports/email/send-report";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Find schedules that are due
  const now = new Date();
  const schedules = await db.reportSchedule.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: now },
    },
    include: {
      report: true,
    },
    take: 10, // Process up to 10 per invocation
  });

  let processed = 0;
  let errors = 0;

  for (const schedule of schedules) {
    const run = await db.reportRun.create({
      data: {
        reportId: schedule.reportId,
        triggeredBy: "SCHEDULE",
        status: "RUNNING",
      },
    });

    try {
      const config = reportConfigSchema.parse(schedule.report.config);
      const source = getDataSource(schedule.report.dataSource as DataSourceId);
      const result = await source.execute(config, schedule.report.tenantId);

      // Generate file
      let fileBuffer: Buffer;
      const format = schedule.format.toLowerCase();
      switch (format) {
        case "pdf":
          fileBuffer = await generatePdf(result, schedule.report.name);
          break;
        case "xlsx":
          fileBuffer = await generateXlsx(result, schedule.report.name);
          break;
        default:
          fileBuffer = Buffer.from(generateCsv(result), "utf-8");
      }

      // Send email
      const recipients = schedule.recipients as string[];
      await sendReportEmail({
        recipients,
        reportName: schedule.report.name,
        format: schedule.format,
        fileBuffer,
        rowCount: result.totalRows,
      });

      // Update run record
      await db.reportRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          rowCount: result.totalRows,
        },
      });

      // Calculate next run time using the cron expression
      const nextRun = calculateNextRun(schedule.cronExpr, schedule.timezone);
      await db.reportSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: now,
          nextRunAt: nextRun,
        },
      });

      processed++;
    } catch (err) {
      await db.reportRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: err instanceof Error ? err.message : "Unknown error",
        },
      });
      errors++;
    }
  }

  return NextResponse.json({ processed, errors, total: schedules.length });
}

/**
 * Simple next-run calculator from a 5-field cron expression.
 * Checks the next 1440 minutes (24 hours) to find a match.
 */
function calculateNextRun(cronExpr: string, _timezone: string): Date {
  const [minPart, hourPart, dayPart, monthPart, dowPart] = cronExpr.split(" ");
  const now = new Date();

  for (let offset = 1; offset <= 1440 * 31; offset++) {
    const candidate = new Date(now.getTime() + offset * 60_000);
    if (
      matchesCronField(minPart, candidate.getUTCMinutes()) &&
      matchesCronField(hourPart, candidate.getUTCHours()) &&
      matchesCronField(dayPart, candidate.getUTCDate()) &&
      matchesCronField(monthPart, candidate.getUTCMonth() + 1) &&
      matchesCronField(dowPart, candidate.getUTCDay())
    ) {
      return candidate;
    }
  }

  // Fallback: 24 hours from now
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepNum = parseInt(step, 10);
      if (range === "*") {
        if (value % stepNum === 0) return true;
      }
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (value >= start && value <= end) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }

  return false;
}
