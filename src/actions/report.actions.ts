"use server";

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { getDataSource, getAllDataSources } from "@/lib/reports/data-sources";
import {
  createReportSchema,
  updateReportSchema,
  createFolderSchema,
  renameFolderSchema,
  reportConfigSchema,
  reportScheduleSchema,
  shareReportSchema,
  type DataSourceId,
  type ReportConfig,
} from "@/lib/validators/report.schema";
import type { ReportResult } from "@/lib/reports/data-sources";

// ─── Data Sources (metadata only, no execution) ────────────────────────────

export const getDataSourceDefinitions = withRBAC(
  "REPORT_MANAGE",
  async () => {
    return getAllDataSources().map((ds) => ({
      id: ds.id,
      label: ds.label,
      description: ds.description,
      icon: ds.icon,
      columns: ds.columns,
      filters: ds.filters,
      groupableFields: ds.groupableFields,
    }));
  }
);

// ─── Report CRUD ────────────────────────────────────────────────────────────

export const createReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: unknown) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = createReportSchema.parse(input);

    // Validate config against the chosen data source
    const source = getDataSource(parsed.dataSource as DataSourceId);
    validateColumnsAgainstSource(parsed.config.columns, source.columns.map((c) => c.id));

    const session = await getSessionUserId();

    const report = await db.reportDefinition.create({
      data: {
        tenantId,
        ownerId: session,
        name: parsed.name,
        description: parsed.description,
        dataSource: parsed.dataSource,
        config: parsed.config as unknown as Prisma.InputJsonValue,
        folderId: parsed.folderId || undefined,
        visibility: parsed.visibility,
      },
    });

    await writeAuditLog({
      tenantId,
      action: "REPORT_CREATED",
      entityType: "REPORT",
      entityId: report.id,
      changes: { after: { name: report.name, dataSource: report.dataSource } },
    });

    return report;
  }
);

export const updateReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { id: string; data: unknown }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = updateReportSchema.parse(input.data);

    const existing = await db.reportDefinition.findFirstOrThrow({
      where: { id: input.id, tenantId },
    });

    if (parsed.config) {
      const source = getDataSource(existing.dataSource as DataSourceId);
      validateColumnsAgainstSource(parsed.config.columns, source.columns.map((c) => c.id));
    }

    const report = await db.reportDefinition.update({
      where: { id: input.id },
      data: {
        name: parsed.name,
        description: parsed.description,
        config: parsed.config as unknown as Prisma.InputJsonValue | undefined,
        folderId: parsed.folderId,
        visibility: parsed.visibility,
      },
    });

    return report;
  }
);

export const deleteReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { id: string }) => {
    if (!tenantId) throw new Error("Tenant context required");

    const report = await db.reportDefinition.findFirstOrThrow({
      where: { id: input.id, tenantId, isTemplate: false },
    });

    await db.reportDefinition.delete({ where: { id: report.id } });

    await writeAuditLog({
      tenantId,
      action: "REPORT_DELETED",
      entityType: "REPORT",
      entityId: report.id,
      changes: { before: { name: report.name } },
    });

    return { deleted: true };
  }
);

export const duplicateReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { id: string; name: string }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const session = await getSessionUserId();

    const source = await db.reportDefinition.findFirstOrThrow({
      where: { id: input.id, tenantId },
    });

    const copy = await db.reportDefinition.create({
      data: {
        tenantId,
        ownerId: session,
        name: input.name,
        description: source.description,
        dataSource: source.dataSource,
        config: source.config as Prisma.InputJsonValue,
        visibility: "PRIVATE",
      },
    });

    return copy;
  }
);

// ─── Get reports ────────────────────────────────────────────────────────────

export const getMyReports = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const session = await getSessionUserId();

    const [owned, shared, tenantWide] = await Promise.all([
      db.reportDefinition.findMany({
        where: { tenantId, ownerId: session },
        include: { folder: true, owner: { select: { name: true } }, _count: { select: { runs: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      db.reportShare.findMany({
        where: { sharedWith: session, report: { tenantId } },
        include: {
          report: {
            include: { folder: true, owner: { select: { name: true } }, _count: { select: { runs: true } } },
          },
        },
      }),
      db.reportDefinition.findMany({
        where: { tenantId, visibility: "TENANT", ownerId: { not: session } },
        include: { folder: true, owner: { select: { name: true } }, _count: { select: { runs: true } } },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    return {
      owned,
      shared: shared.map((s) => ({ ...s.report, canEdit: s.canEdit })),
      tenantWide,
    };
  }
);

export const getReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { id: string }) => {
    if (!tenantId) throw new Error("Tenant context required");

    const report = await db.reportDefinition.findFirstOrThrow({
      where: { id: input.id, tenantId },
      include: {
        folder: true,
        owner: { select: { id: true, name: true } },
        shares: { include: { user: { select: { id: true, name: true, email: true } } } },
        schedules: true,
        runs: { orderBy: { startedAt: "desc" }, take: 10 },
      },
    });

    return report;
  }
);

// ─── Run report ─────────────────────────────────────────────────────────────

export const runReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { reportId?: string; dataSource?: string; config?: unknown }): Promise<ReportResult> => {
    if (!tenantId) throw new Error("Tenant context required");
    const session = await getSessionUserId();

    let dataSourceId: DataSourceId;
    let config: ReportConfig;

    if (input.reportId) {
      // Run a saved report
      const report = await db.reportDefinition.findFirstOrThrow({
        where: { id: input.reportId, tenantId },
      });
      dataSourceId = report.dataSource as DataSourceId;
      config = reportConfigSchema.parse(report.config);
    } else if (input.dataSource && input.config) {
      // Run ad-hoc (preview)
      dataSourceId = input.dataSource as DataSourceId;
      config = reportConfigSchema.parse(input.config);
    } else {
      throw new Error("Either reportId or dataSource+config required");
    }

    const source = getDataSource(dataSourceId);
    validateColumnsAgainstSource(config.columns, source.columns.map((c) => c.id));

    // Create run record
    const run = input.reportId
      ? await db.reportRun.create({
          data: {
            reportId: input.reportId,
            triggeredBy: "MANUAL",
            userId: session,
            status: "RUNNING",
          },
        })
      : null;

    try {
      const result = await source.execute(config, tenantId);

      if (run) {
        await db.reportRun.update({
          where: { id: run.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            rowCount: result.totalRows,
          },
        });
      }

      return result;
    } catch (err) {
      if (run) {
        await db.reportRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: err instanceof Error ? err.message : "Unknown error",
          },
        });
      }
      throw err;
    }
  }
);

// ─── Folders ────────────────────────────────────────────────────────────────

export const getMyFolders = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const session = await getSessionUserId();

    return db.reportFolder.findMany({
      where: { tenantId, ownerId: session },
      include: { children: true, _count: { select: { reports: true } } },
      orderBy: { name: "asc" },
    });
  }
);

export const createFolder = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: unknown) => {
    if (!tenantId) throw new Error("Tenant context required");
    const session = await getSessionUserId();
    const parsed = createFolderSchema.parse(input);

    return db.reportFolder.create({
      data: {
        tenantId,
        ownerId: session,
        name: parsed.name,
        parentId: parsed.parentId,
      },
    });
  }
);

export const renameFolder = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { id: string; data: unknown }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = renameFolderSchema.parse(input.data);

    await db.reportFolder.findFirstOrThrow({
      where: { id: input.id, tenantId },
    });

    return db.reportFolder.update({
      where: { id: input.id },
      data: { name: parsed.name },
    });
  }
);

export const deleteFolder = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { id: string }) => {
    if (!tenantId) throw new Error("Tenant context required");

    // Unlink reports from folder before deleting
    await db.reportDefinition.updateMany({
      where: { folderId: input.id, tenantId },
      data: { folderId: null },
    });

    await db.reportFolder.delete({ where: { id: input.id } });

    return { deleted: true };
  }
);

export const moveReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { reportId: string; folderId: string | null }) => {
    if (!tenantId) throw new Error("Tenant context required");

    await db.reportDefinition.findFirstOrThrow({
      where: { id: input.reportId, tenantId },
    });

    return db.reportDefinition.update({
      where: { id: input.reportId },
      data: { folderId: input.folderId },
    });
  }
);

// ─── Sharing ────────────────────────────────────────────────────────────────

export const shareReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { reportId: string; data: unknown }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = shareReportSchema.parse(input.data);

    await db.reportDefinition.findFirstOrThrow({
      where: { id: input.reportId, tenantId },
    });

    return db.reportShare.upsert({
      where: {
        reportId_sharedWith: {
          reportId: input.reportId,
          sharedWith: parsed.userId,
        },
      },
      create: {
        reportId: input.reportId,
        sharedWith: parsed.userId,
        canEdit: parsed.canEdit,
      },
      update: { canEdit: parsed.canEdit },
    });
  }
);

export const unshareReport = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }, input: { reportId: string; userId: string }) => {
    if (!tenantId) throw new Error("Tenant context required");

    await db.reportShare.deleteMany({
      where: {
        reportId: input.reportId,
        sharedWith: input.userId,
        report: { tenantId },
      },
    });

    return { deleted: true };
  }
);

// ─── Email status ───────────────────────────────────────────────────────────

export const checkEmailConfigured = withRBAC(
  "REPORT_SCHEDULE",
  async () => {
    return {
      configured: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
    };
  }
);

// ─── Schedules ──────────────────────────────────────────────────────────────

export const createSchedule = withRBAC(
  "REPORT_SCHEDULE",
  async ({ tenantId }, input: unknown) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = reportScheduleSchema.parse(input);

    // Verify report belongs to tenant
    await db.reportDefinition.findFirstOrThrow({
      where: { id: parsed.reportId, tenantId },
    });

    // Calculate first nextRunAt
    const nextRunAt = calculateNextRun(parsed.cronExpr);

    const schedule = await db.reportSchedule.create({
      data: {
        reportId: parsed.reportId,
        cronExpr: parsed.cronExpr,
        timezone: parsed.timezone,
        format: parsed.format,
        recipients: parsed.recipients,
        nextRunAt,
      },
    });

    return schedule;
  }
);

export const updateSchedule = withRBAC(
  "REPORT_SCHEDULE",
  async ({ tenantId }, input: { id: string; data: unknown }) => {
    if (!tenantId) throw new Error("Tenant context required");
    const parsed = reportScheduleSchema.parse(input.data);

    // Verify schedule's report belongs to tenant
    const existing = await db.reportSchedule.findFirstOrThrow({
      where: { id: input.id },
      include: { report: { select: { tenantId: true } } },
    });
    if (existing.report.tenantId !== tenantId) throw new Error("Access denied");

    const nextRunAt = calculateNextRun(parsed.cronExpr);

    return db.reportSchedule.update({
      where: { id: input.id },
      data: {
        cronExpr: parsed.cronExpr,
        timezone: parsed.timezone,
        format: parsed.format,
        recipients: parsed.recipients,
        nextRunAt,
      },
    });
  }
);

export const deleteSchedule = withRBAC(
  "REPORT_SCHEDULE",
  async ({ tenantId }, input: { id: string }) => {
    if (!tenantId) throw new Error("Tenant context required");

    const existing = await db.reportSchedule.findFirstOrThrow({
      where: { id: input.id },
      include: { report: { select: { tenantId: true } } },
    });
    if (existing.report.tenantId !== tenantId) throw new Error("Access denied");

    await db.reportSchedule.delete({ where: { id: input.id } });
    return { deleted: true };
  }
);

export const toggleSchedule = withRBAC(
  "REPORT_SCHEDULE",
  async ({ tenantId }, input: { id: string; isActive: boolean }) => {
    if (!tenantId) throw new Error("Tenant context required");

    const existing = await db.reportSchedule.findFirstOrThrow({
      where: { id: input.id },
      include: { report: { select: { tenantId: true } } },
    });
    if (existing.report.tenantId !== tenantId) throw new Error("Access denied");

    return db.reportSchedule.update({
      where: { id: input.id },
      data: { isActive: input.isActive },
    });
  }
);

// ─── Tenant users (for share dialog) ────────────────────────────────────────

export const getTenantUsers = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }) => {
    if (!tenantId) throw new Error("Tenant context required");

    return db.user.findMany({
      where: {
        employee: { tenantId },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
  }
);

// ─── Filter options (for building dynamic filter dropdowns) ─────────────────

export const getFilterOptions = withRBAC(
  "REPORT_MANAGE",
  async ({ tenantId }) => {
    if (!tenantId) throw new Error("Tenant context required");

    const [sites, departments, payPeriods, leaveTypes] = await Promise.all([
      db.site.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.department.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.payPeriod.findMany({
        where: { tenantId },
        select: { id: true, startDate: true, endDate: true, status: true },
        orderBy: { startDate: "desc" },
      }),
      db.leaveType.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return { sites, departments, payPeriods, leaveTypes };
  }
);

// ─── Helpers ────────────────────────────────────────────────────────────────

import { auth } from "@/lib/auth";

async function getSessionUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

function validateColumnsAgainstSource(
  requestedColumns: string[],
  availableColumnIds: string[]
) {
  const invalid = requestedColumns.filter((c) => !availableColumnIds.includes(c));
  if (invalid.length > 0) {
    throw new Error(`Invalid columns: ${invalid.join(", ")}`);
  }
}

function calculateNextRun(cronExpr: string): Date {
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

  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepNum = parseInt(step, 10);
      if (range === "*" && value % stepNum === 0) return true;
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (value >= start && value <= end) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }

  return false;
}
