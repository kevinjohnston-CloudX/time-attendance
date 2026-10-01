"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { validatePayPeriodTransition } from "@/lib/state-machines/pay-period-state";
import { validatePayPeriod } from "@/lib/engines/validation-engine";
import {
  payPeriodIdSchema,
  reopenPayPeriodSchema,
} from "@/lib/validators/pay-period.schema";
import { writeAuditLog } from "@/lib/audit/logger";
import { nextTenantPeriod } from "@/lib/pay-period-utils";
import { lockPeriod } from "@/lib/payroll/lock-period";
import type { PayFrequency } from "@prisma/client";

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getPayPeriods = withRBAC("PAY_PERIOD_MANAGE", async ({ tenantId }, _input: void) => {
  // With no company, tenantId undefined would match every company's periods.
  if (!tenantId) throw new Error("Tenant context required");
  return db.payPeriod.findMany({
    where: { tenantId },
    orderBy: { startDate: "desc" },
    include: {
      timesheets: {
        select: { status: true },
      },
      ruleSet: {
        select: { id: true, name: true, payFrequency: true },
      },
    },
  });
});

export const getPayPeriodDetail = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (
    { tenantId },
    input: { payPeriodId: string }
  ) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);

    // Scoped to the caller's company in the query itself: an id from another
    // tenant finds nothing, the same as an id that does not exist.
    if (!tenantId) throw new Error("Pay period not found");
    const inScope = await db.payPeriod.findFirst({
      where: { id: payPeriodId, tenantId },
      select: { id: true },
    });
    if (!inScope) throw new Error("Pay period not found");

    const [payPeriod, validation] = await Promise.all([
      db.payPeriod.findUniqueOrThrow({
        where: { id: payPeriodId },
        include: {
          timesheets: {
            include: {
              employee: { include: { user: true, site: { select: { id: true, name: true } } } },
              overtimeBuckets: true,
              exceptions: { where: { resolvedAt: null } },
            },
          },
        },
      }),
      validatePayPeriod(payPeriodId),
    ]);

    return { payPeriod, validation };
  }
);

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * The period, only if it belongs to the caller's company. Every write below
 * starts here: looked up by id alone, a period id from another company (they
 * appear in links and the audit log) would be locked or reopened from this one.
 */
async function findPeriodInScope(payPeriodId: string, tenantId: string | null) {
  if (!tenantId) throw new Error("Pay period not found");
  const payPeriod = await db.payPeriod.findFirst({ where: { id: payPeriodId, tenantId } });
  if (!payPeriod) throw new Error("Pay period not found");
  return payPeriod;
}

/**
 * OPEN → LOCKED. There are no approval steps: every timecard in the period is
 * open until this locks it. Also posts per-period accruals and auto-posts any
 * APPROVED leave requests that overlap this pay period.
 */
export const lockPayPeriod = withRBAC(
  "PAYROLL_RUN",
  async (actor, input: { payPeriodId: string }) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);
    await lockPeriod(payPeriodId, actor);

    revalidatePath("/payroll/pay-periods");
    revalidatePath(`/payroll/pay-periods/${payPeriodId}`);
    return { payPeriodId };
  }
);

/**
 * LOCKED → OPEN. Its timecards go back to Open and can be edited again.
 */
export const reopenPayPeriod = withRBAC(
  "PAYROLL_RUN",
  async (actor, input: { payPeriodId: string; reason: string }) => {
    const { payPeriodId, reason } = reopenPayPeriodSchema.parse(input);

    const payPeriod = await findPeriodInScope(payPeriodId, actor.tenantId);

    const transition = validatePayPeriodTransition(payPeriod.status, "REOPEN");
    if (!transition.valid) throw new Error(transition.error);

    if (payPeriod.status === "LOCKED") {
      await db.timesheet.updateMany({
        where: { payPeriodId, status: "LOCKED" },
        data: { status: "OPEN", lockedAt: null },
      });
    }

    const updated = await db.payPeriod.update({
      where: { id: payPeriodId },
      data: { status: transition.newStatus },
    });

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorId: actor.employeeId,
      entityType: "PAY_PERIOD",
      entityId: payPeriodId,
      action: "REOPEN",
      changes: { before: payPeriod.status, after: { status: transition.newStatus, reason } },
    });

    revalidatePath("/payroll/pay-periods");
    revalidatePath(`/payroll/pay-periods/${payPeriodId}`);
    return updated;
  }
);

// ─── Tenant pay-period settings ───────────────────────────────────────────────

export const getTenantSettings = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId }, _input: void) => {
    if (!tenantId) throw new Error("No tenant context");
    const [tenant, nextPeriod, defaultRuleSets] = await Promise.all([
      db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { payFrequency: true, payPeriodAnchorDate: true, name: true },
      }),
      nextTenantPeriod(tenantId),
      // The rule sets that fall back to these settings, so the page can say
      // who they apply to rather than leave the reader to work it out.
      db.ruleSet.findMany({
        where: { tenantId, OR: [{ payFrequency: null }, { payPeriodAnchorDate: null }] },
        select: { name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    return { ...tenant, nextPeriod, defaultRuleSets: defaultRuleSets.map((r) => r.name) };
  }
);

const PAY_FREQUENCIES: PayFrequency[] = ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY", "MONTHLY"];

export const updateTenantSettings = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId, employeeId }, input: { payFrequency: PayFrequency; payPeriodAnchorDate: string }) => {
    if (!tenantId) throw new Error("No tenant context");
    if (!PAY_FREQUENCIES.includes(input.payFrequency)) throw new Error("Choose a pay frequency");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payPeriodAnchorDate ?? "")) throw new Error("Choose an anchor date");
    // Append T12:00:00 so the date string is parsed as local noon, not UTC midnight.
    // Parsing a bare "YYYY-MM-DD" as UTC midnight shifts it back one day for US timezones.
    const anchor = new Date(input.payPeriodAnchorDate + "T12:00:00");
    if (isNaN(anchor.getTime())) throw new Error("Invalid anchor date");
    const before = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { payFrequency: true, payPeriodAnchorDate: true },
    });
    const updated = await db.tenant.update({
      where: { id: tenantId },
      data: { payFrequency: input.payFrequency, payPeriodAnchorDate: anchor },
    });
    // There is no company entry type in the log, and these two fields exist
    // only to shape pay periods, so the change is filed under pay periods
    // with the company as the record.
    await writeAuditLog({
      tenantId,
      actorId: employeeId,
      entityType: "PAY_PERIOD",
      entityId: tenantId,
      action: "SETTINGS_UPDATE",
      changes: {
        before: { payFrequency: before.payFrequency, payPeriodAnchorDate: before.payPeriodAnchorDate },
        after: { payFrequency: updated.payFrequency, payPeriodAnchorDate: updated.payPeriodAnchorDate },
      },
    });
    revalidatePath("/admin/settings");
    return { payFrequency: updated.payFrequency, payPeriodAnchorDate: updated.payPeriodAnchorDate };
  }
);

/**
 * Adds the company level period after the latest one: the one the settings
 * page showed. The caller passes the start date it showed, and a different
 * answer now (someone else generated one, or the settings changed) refuses
 * rather than create a period nobody saw.
 */
export const generateNextPayPeriod = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId, employeeId }, input: { startDate: string }) => {
    if (!tenantId) throw new Error("No tenant context");

    const next = await nextTenantPeriod(tenantId);
    if (!next) throw new Error("Save an anchor date before generating a pay period.");
    if (next.startDate.toISOString() !== input?.startDate) {
      throw new Error("The next pay period changed since this page loaded. Refresh the page and try again.");
    }

    const existing = await db.payPeriod.findFirst({
      where: { tenantId, ruleSetId: null, startDate: next.startDate },
      select: { id: true },
    });
    if (existing) throw new Error("That pay period already exists.");

    const period = await db.payPeriod.create({
      data: { tenantId, startDate: next.startDate, endDate: next.endDate, status: "OPEN" },
    });

    await writeAuditLog({
      tenantId,
      actorId: employeeId,
      entityType: "PAY_PERIOD",
      entityId: period.id,
      action: "CREATE",
      changes: { after: { startDate: next.startDate, endDate: next.endDate, frequency: next.frequency, source: "MANUAL" } },
    });

    revalidatePath("/payroll/pay-periods");
    revalidatePath("/admin/settings");
    return { startDate: next.startDate, endDate: next.endDate, frequency: next.frequency };
  }
);
