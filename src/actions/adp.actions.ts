"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { AdpClient, getAdpConfig } from "@/lib/integrations/adp/client";
import { PAY_BUCKET_TO_ADP_CODE } from "@/lib/integrations/adp/types";
import type { AdpEarningEntry } from "@/lib/integrations/adp/types";
import {
  mapAdpWorker,
  generateUsername,
  generateTempPassword,
} from "@/lib/integrations/adp/mapper";

// ─── Config Status ────────────────────────────────────────────────────────────

/**
 * Whether ADP is configured, and what the company last exchanged with it in
 * each direction: the newest employee sync, and the newest pay period whose
 * hours were pushed.
 *
 * <p>Both reads are held to the caller's company. The employee sync is read by
 * its own action: the payroll push writes under the same entity type, so the
 * newest ADP_SYNC row alone could be a push, and "Last sync" would show its
 * date.
 */
export const getAdpSyncStatus = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const config = getAdpConfig();

    const [lastSync, adpEmployeeCount, activeCount, activeLinkedCount, lastPush] = await Promise.all([
      db.auditLog.findFirst({
        where: { entityType: "ADP_SYNC", action: "ADP_SYNC_COMPLETED", tenantId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, changes: true },
      }),
      db.employee.count({ where: { adpWorkerId: { not: null }, tenantId } }),
      // Active people with no ADP worker ID are the ones a sync cannot match,
      // and would add a second time.
      db.employee.count({ where: { isActive: true, tenantId } }),
      db.employee.count({ where: { isActive: true, adpWorkerId: { not: null }, tenantId } }),
      db.payrollRun.findFirst({
        where: { exportedAt: { not: null }, payPeriod: { tenantId } },
        orderBy: { exportedAt: "desc" },
        select: {
          exportedAt: true,
          pushedCount: true,
          skippedCount: true,
          errorCount: true,
          payPeriod: { select: { id: true, startDate: true, endDate: true } },
        },
      }),
    ]);

    return {
      isConfigured: config !== null,
      lastSyncAt: lastSync?.createdAt ?? null,
      lastSyncResult: lastSync?.changes ?? null,
      adpEmployeeCount,
      activeCount,
      activeUnlinkedCount: activeCount - activeLinkedCount,
      lastPush: lastPush?.exportedAt
        ? {
            at: lastPush.exportedAt,
            pushed: lastPush.pushedCount,
            skipped: lastPush.skippedCount,
            errorCount: lastPush.errorCount,
            payPeriodId: lastPush.payPeriod.id,
            startDate: lastPush.payPeriod.startDate,
            endDate: lastPush.payPeriod.endDate,
          }
        : null,
    };
  }
);

/**
 * The three lists a sync's defaults are picked from, and nothing else. The
 * page used to borrow the admin reference data, which also carries every
 * active employee in the company for a Supervisor dropdown this page does not
 * have.
 */
export const getAdpSyncOptions = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ tenantId }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const [sites, departments, ruleSets] = await Promise.all([
      db.site.findMany({
        where: { isActive: true, tenantId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.department.findMany({
        where: { isActive: true, tenantId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, sites: { select: { siteId: true } } },
      }),
      db.ruleSet.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isDefault: true },
      }),
    ]);
    return {
      sites,
      departments: departments.map((d) => ({ id: d.id, name: d.name, siteIds: d.sites.map((x) => x.siteId) })),
      ruleSets,
    };
  }
);

// ─── Test Connection ──────────────────────────────────────────────────────────

/** Test ADP API connectivity by fetching the first page of workers. */
export const testAdpConnection = withRBAC(
  "EMPLOYEE_MANAGE",
  async () => {
    const config = getAdpConfig();
    if (!config) throw new Error("ADP is not configured. Set ADP environment variables.");

    const client = new AdpClient(config);
    const result = await client.testConnection();

    return {
      workerCount: result.workerCount,
      sampleNames: result.firstPage.map(
        (w) =>
          `${w.person.legalName.givenName} ${w.person.legalName.familyName1}`
      ),
    };
  }
);

// ─── Sync Employees ───────────────────────────────────────────────────────────

interface SyncInput {
  defaultSiteId: string;
  defaultDeptId: string;
  defaultRuleSetId: string;
}

interface SyncResult {
  created: number;
  updated: number;
  deactivated: number;
  errors: string[];
  /** Temporary passwords for newly created employees (shown once) */
  newCredentials: Array<{ name: string; username: string; tempPassword: string }>;
}

/** Fetch all workers from ADP and upsert into the database. */
export const syncAdpEmployees = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: SyncInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const config = getAdpConfig();
    if (!config) throw new Error("ADP is not configured. Set ADP environment variables.");

    // Every new hire is written with these three, so each has to be the
    // company's own and still in use, checked before ADP is even called.
    const [site, dept, ruleSet] = await Promise.all([
      db.site.count({ where: { id: input.defaultSiteId, tenantId, isActive: true } }),
      db.department.count({ where: { id: input.defaultDeptId, tenantId, isActive: true } }),
      db.ruleSet.count({ where: { id: input.defaultRuleSetId, tenantId } }),
    ]);
    if (!site || !dept || !ruleSet) throw new Error("NOT_FOUND");

    const client = new AdpClient(config);
    const adpWorkers = await client.getAllWorkers();

    const result: SyncResult = {
      created: 0,
      updated: 0,
      deactivated: 0,
      errors: [],
      newCredentials: [],
    };

    // Load existing ADP-linked employees for matching
    const existingEmployees = await db.employee.findMany({
      where: { adpWorkerId: { not: null }, tenantId },
      include: { user: true },
    });
    const byAdpId = new Map(
      existingEmployees.map((e) => [e.adpWorkerId!, e])
    );

    for (const adpWorker of adpWorkers) {
      const mapped = mapAdpWorker(adpWorker);

      try {
        const existing = byAdpId.get(mapped.adpWorkerId);

        if (existing) {
          // ── Update existing employee ──
          const updates: Record<string, unknown> = {};
          const userUpdates: Record<string, unknown> = {};

          if (existing.user.name !== mapped.name) userUpdates.name = mapped.name;
          if (existing.user.email !== mapped.email) userUpdates.email = mapped.email;
          if (existing.isActive !== mapped.isActive) {
            updates.isActive = mapped.isActive;
            if (!mapped.isActive && mapped.terminatedAt) {
              updates.terminatedAt = mapped.terminatedAt;
            }
          }

          const hasChanges =
            Object.keys(updates).length > 0 ||
            Object.keys(userUpdates).length > 0;

          if (hasChanges) {
            await db.$transaction([
              ...(Object.keys(userUpdates).length > 0
                ? [
                    db.user.update({
                      where: { id: existing.userId },
                      data: userUpdates,
                    }),
                  ]
                : []),
              ...(Object.keys(updates).length > 0
                ? [
                    db.employee.update({
                      where: { id: existing.id },
                      data: updates,
                    }),
                  ]
                : []),
            ]);

            if (!mapped.isActive && existing.isActive) {
              result.deactivated++;
            } else {
              result.updated++;
            }
          }
        } else {
          // ── Create new employee ──
          const username = generateUsername(mapped.adpWorkerId);

          // Check if username already exists
          const existingUser = await db.user.findUnique({
            where: { username },
          });
          if (existingUser) {
            result.errors.push(
              `Username "${username}" already exists for ${mapped.name}`
            );
            continue;
          }

          const { plaintext, hash } = await generateTempPassword();

          await db.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                name: mapped.name,
                email: mapped.email,
                username,
                passwordHash: hash,
              },
            });

            await tx.employee.create({
              data: {
                userId: user.id,
                tenantId,
                employeeCode: mapped.employeeCode,
                adpWorkerId: mapped.adpWorkerId,
                role: "EMPLOYEE",
                siteId: input.defaultSiteId,
                departmentId: input.defaultDeptId,
                ruleSetId: input.defaultRuleSetId,
                hireDate: mapped.hireDate,
                isActive: mapped.isActive,
                terminatedAt: mapped.terminatedAt,
              },
            });
          });

          result.created++;
          result.newCredentials.push({
            name: mapped.name,
            username,
            tempPassword: plaintext,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${mapped.name} (${mapped.adpWorkerId}): ${msg}`);
      }
    }

    // Write a summary audit log
    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "ADP_SYNC",
      entityId: "sync",
      action: "ADP_SYNC_COMPLETED",
      changes: {
        after: {
          totalFetched: adpWorkers.length,
          created: result.created,
          updated: result.updated,
          deactivated: result.deactivated,
          errorCount: result.errors.length,
        },
      },
    });

    revalidatePath("/admin/employees");
    return result;
  }
);

// ─── Push Payroll ─────────────────────────────────────────────────────────────

interface PayrollPushResult {
  pushed: number;
  skipped: number;
  errors: string[];
}

/** Push locked pay period hours to ADP Payroll Data Input API. */
export const pushPayrollToAdp = withRBAC(
  "PAYROLL_RUN",
  async ({ employeeId: actorId, tenantId }, input: { payPeriodId: string }) => {
    if (!tenantId) throw new Error("NOT_FOUND");
    const config = getAdpConfig();
    if (!config) throw new Error("ADP is not configured. Set ADP environment variables.");

    // Validate pay period is LOCKED. Found inside the caller's company, so a
    // pay period id from another company is simply not found.
    const payPeriod = await db.payPeriod.findFirst({
      where: { id: input.payPeriodId, tenantId },
    });
    if (!payPeriod) throw new Error("NOT_FOUND");
    if (payPeriod.status !== "LOCKED") {
      throw new Error("Pay period must be locked before pushing to ADP.");
    }

    // Check for existing push
    const existingRun = await db.payrollRun.findUnique({
      where: { payPeriodId: input.payPeriodId },
    });
    if (existingRun?.exportedAt) {
      throw new Error(
        `Payroll was already pushed on ${existingRun.exportedAt.toISOString()}.`
      );
    }

    // Fetch all locked timesheets with hours and employee ADP IDs
    const timesheets = await db.timesheet.findMany({
      where: { payPeriodId: payPeriod.id, status: "LOCKED" },
      include: {
        employee: { select: { adpWorkerId: true, employeeCode: true, user: { select: { name: true } } } },
        overtimeBuckets: true,
      },
    });

    const result: PayrollPushResult = { pushed: 0, skipped: 0, errors: [] };
    const allEntries: AdpEarningEntry[] = [];

    for (const ts of timesheets) {
      const adpId = ts.employee.adpWorkerId;
      const empName = ts.employee.user?.name ?? ts.employee.employeeCode;

      if (!adpId) {
        result.skipped++;
        continue;
      }

      // Convert each bucket to an ADP earning entry
      for (const bucket of ts.overtimeBuckets) {
        if (bucket.totalMinutes <= 0) continue;

        const adpCode = PAY_BUCKET_TO_ADP_CODE[bucket.bucket];
        if (!adpCode) {
          result.errors.push(
            `${empName}: No ADP earning code mapped for bucket "${bucket.bucket}"`
          );
          continue;
        }

        allEntries.push({
          associateOID: adpId,
          earningCode: adpCode,
          hoursValue: Math.round((bucket.totalMinutes / 60) * 100) / 100, // 2 decimal places
        });
      }
    }

    // Push to ADP in batches
    let adpResponse: unknown = null;
    if (allEntries.length > 0) {
      try {
        const client = new AdpClient(config);
        adpResponse = await client.pushPayrollBatch(allEntries);
        result.pushed = new Set(allEntries.map((e) => e.associateOID)).size;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ADP payroll push failed: ${msg}`);
      }
    }

    // Record the push
    await db.payrollRun.upsert({
      where: { payPeriodId: input.payPeriodId },
      update: {
        exportedAt: new Date(),
        exportedById: actorId,
        adpResponse: adpResponse as never,
        pushedCount: result.pushed,
        skippedCount: result.skipped,
        errorCount: result.errors.length,
        status: "LOCKED",
      },
      create: {
        payPeriodId: input.payPeriodId,
        exportedAt: new Date(),
        exportedById: actorId,
        adpResponse: adpResponse as never,
        pushedCount: result.pushed,
        skippedCount: result.skipped,
        errorCount: result.errors.length,
        status: "LOCKED",
      },
    });

    await writeAuditLog({
      tenantId,
      actorId,
      entityType: "ADP_SYNC",
      entityId: input.payPeriodId,
      action: "ADP_PAYROLL_PUSHED",
      changes: {
        after: {
          pushed: result.pushed,
          skipped: result.skipped,
          errorCount: result.errors.length,
          totalEntries: allEntries.length,
        },
      },
    });

    revalidatePath(`/payroll/pay-periods/${input.payPeriodId}`);
    return result;
  }
);
