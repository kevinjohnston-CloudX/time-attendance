import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDataSource } from "@/lib/reports/data-sources";
import { reportConfigSchema, type DataSourceId } from "@/lib/validators/report.schema";
import { generateCsv } from "@/lib/reports/export/csv";
import { generatePdf } from "@/lib/reports/export/pdf";
import { generateXlsx } from "@/lib/reports/export/xlsx";
import { sendReportEmail, isEmailConfigured } from "@/lib/reports/email/send-report";
import { nextRun } from "@/lib/reports/schedule-time";
import { reportFileStem } from "@/lib/reports/file-name";

/**
 * Sends the scheduled reports that are due. Called every 15 minutes.
 *
 * <p>A schedule is claimed before its report is built: its next send time is
 * moved forward in a conditional update, so two overlapping calls can never
 * both send it, and a call that dies halfway does not send it twice on the
 * next round. If building or sending fails, the failure is recorded in the
 * report's run history and the send is tried again in half an hour, up to
 * three failures in a day, before it waits for its next regular time.
 *
 * <p>"Yesterday" and "last month" are read in the schedule's own time zone.
 */

const BATCH = 10;
const RETRY_AFTER_MS = 30 * 60_000;
const MAX_FAILURES_PER_DAY = 3;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const now = new Date();
  const due = await db.reportSchedule.findMany({
    where: { isActive: true, nextRunAt: { lte: now } },
    include: { report: true },
    orderBy: { nextRunAt: "asc" },
    take: BATCH,
  });

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  for (const schedule of due) {
    const next = nextRun(schedule.cronExpr, schedule.timezone, now);

    // Claim it. When nothing is updated another call already has.
    const claim = await db.reportSchedule.updateMany({
      where: { id: schedule.id, isActive: true, nextRunAt: schedule.nextRunAt },
      data: next ? { nextRunAt: next } : { nextRunAt: null, isActive: false },
    });
    if (claim.count === 0) {
      skipped++;
      continue;
    }

    const run = await db.reportRun.create({
      data: { reportId: schedule.reportId, triggeredBy: "SCHEDULE", status: "RUNNING" },
    });

    try {
      if (!isEmailConfigured()) throw new Error("Email is not set up on this server, so nothing was sent.");
      const recipients = (Array.isArray(schedule.recipients) ? schedule.recipients : []).filter(
        (r): r is string => typeof r === "string" && r.includes("@")
      );
      if (!recipients.length) throw new Error("This schedule has no one to send to.");

      const config = reportConfigSchema.parse(schedule.report.config);
      const source = getDataSource(schedule.report.dataSource as DataSourceId);
      const result = await source.execute(config, schedule.report.tenantId, { timezone: schedule.timezone, now });

      const format = schedule.format.toLowerCase();
      let fileBuffer: Buffer;
      if (format === "pdf") fileBuffer = await generatePdf(result, schedule.report.name);
      else if (format === "xlsx") fileBuffer = await generateXlsx(result, schedule.report.name);
      else fileBuffer = Buffer.from(generateCsv(result), "utf-8");

      await sendReportEmail({
        recipients,
        reportName: schedule.report.name,
        format: schedule.format,
        fileBuffer,
        rowCount: result.totalRows,
        shownRows: result.rows.length,
        fileStem: reportFileStem(schedule.report.name, result, source.brand),
        periodLabel: result.period?.label,
        brand: source.brand,
      });

      await db.reportRun.update({
        where: { id: run.id },
        data: { status: "COMPLETED", completedAt: new Date(), rowCount: result.totalRows },
      });
      await db.reportSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: now } });
      processed++;
    } catch (err) {
      await db.reportRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: (err instanceof Error ? err.message : "Unknown error").slice(0, 500),
        },
      });

      // Try again soon, unless it keeps failing or its regular time is sooner.
      const failures = await db.reportRun.count({
        where: {
          reportId: schedule.reportId,
          triggeredBy: "SCHEDULE",
          status: "FAILED",
          startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
        },
      });
      const retryAt = new Date(now.getTime() + RETRY_AFTER_MS);
      if (failures < MAX_FAILURES_PER_DAY && next && retryAt < next) {
        await db.reportSchedule.updateMany({ where: { id: schedule.id, isActive: true }, data: { nextRunAt: retryAt } });
      }
      errors++;
    }
  }

  return NextResponse.json({ processed, errors, skipped, total: due.length });
}
