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
import { postAccruals, postLeaveUsage } from "@/lib/engines/accrual-engine";
import { nextTenantPeriod } from "@/lib/pay-period-utils";
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
 * appear in links and the audit log) would be marked ready, locked, reopened
 * or bulk approved from this one.
 */
async function findPeriodInScope(payPeriodId: string, tenantId: string | null) {
  if (!tenantId) throw new Error("Pay period not found");
  const payPeriod = await db.payPeriod.findFirst({ where: { id: payPeriodId, tenantId } });
  if (!payPeriod) throw new Error("Pay period not found");
  return payPeriod;
}

/**
 * OPEN → READY.
 * Requires all timesheets to be PAYROLL_APPROVED with no unresolved exceptions.
 */
export const markPayPeriodReady = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (actor, input: { payPeriodId: string }) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);

    // Scoped to the caller's company: an id from another company is not found.
    const payPeriod = await findPeriodInScope(payPeriodId, actor.tenantId);

    const transition = validatePayPeriodTransition(payPeriod.status, "MARK_READY");
    if (!transition.valid) throw new Error(transition.error);

    const validation = await validatePayPeriod(payPeriodId);
    if (!validation.isReady) {
      const count = validation.issues.length;
      throw new Error(
        `This pay period has ${count} open issue${count === 1 ? "" : "s"}. Resolve ${count === 1 ? "it" : "them"} before marking the period ready.`
      );
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
      action: "MARK_READY",
      changes: { before: payPeriod.status, after: transition.newStatus },
    });

    revalidatePath("/payroll/pay-periods");
    revalidatePath(`/payroll/pay-periods/${payPeriodId}`);
    return updated;
  }
);

/**
 * READY → LOCKED.
 * Also transitions all PAYROLL_APPROVED timesheets to LOCKED,
 * posts per-period accruals, and auto-posts any APPROVED leave requests
 * that overlap this pay period.
 */
export const lockPayPeriod = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (actor, input: { payPeriodId: string }) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);

    const payPeriod = await findPeriodInScope(payPeriodId, actor.tenantId);

    const transition = validatePayPeriodTransition(payPeriod.status, "LOCK");
    if (!transition.valid) throw new Error(transition.error);

    await db.$transaction([
      db.payPeriod.update({
        where: { id: payPeriodId },
        data: { status: transition.newStatus },
      }),
      db.timesheet.updateMany({
        where: { payPeriodId, status: "PAYROLL_APPROVED" },
        data: { status: "LOCKED", lockedAt: new Date() },
      }),
    ]);

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorId: actor.employeeId,
      entityType: "PAY_PERIOD",
      entityId: payPeriodId,
      action: "LOCK",
      changes: { before: payPeriod.status, after: transition.newStatus },
    });

    // Post per-pay-period accruals for all active employees.
    await postAccruals(payPeriodId);

    // Auto-post all APPROVED leave requests that overlap this period.
    await autoPostApprovedLeave(
      { id: payPeriodId, startDate: payPeriod.startDate, endDate: payPeriod.endDate, tenantId: payPeriod.tenantId },
      actor.employeeId ?? null
    );

    revalidatePath("/payroll/pay-periods");
    revalidatePath(`/payroll/pay-periods/${payPeriodId}`);
    return { payPeriodId };
  }
);

/**
 * READY → OPEN (undo mark-ready).
 */
export const reopenPayPeriod = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (actor, input: { payPeriodId: string; reason: string }) => {
    const { payPeriodId, reason } = reopenPayPeriodSchema.parse(input);

    const payPeriod = await findPeriodInScope(payPeriodId, actor.tenantId);

    const transition = validatePayPeriodTransition(payPeriod.status, "REOPEN");
    if (!transition.valid) throw new Error(transition.error);

    // If reopening from LOCKED, also unlock all LOCKED timesheets
    if (payPeriod.status === "LOCKED") {
      await db.timesheet.updateMany({
        where: { payPeriodId, status: "LOCKED" },
        data: { status: "PAYROLL_APPROVED", lockedAt: null },
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

export const submitOpenTimesheets = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId, employeeId }, input: { payPeriodId: string }) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);

    const payPeriod = await findPeriodInScope(payPeriodId, tenantId);

    if (payPeriod.endDate >= new Date()) {
      throw new Error("Can only bulk-approve timesheets for past pay periods");
    }

    const pending = await db.timesheet.findMany({
      where: { payPeriodId, status: { in: ["OPEN", "SUBMITTED"] } },
      select: { id: true },
    });

    if (pending.length === 0) return { submitted: 0 };

    const now = new Date();
    await db.timesheet.updateMany({
      where: { payPeriodId, status: { in: ["OPEN", "SUBMITTED"] } },
      data: {
        status: "SUP_APPROVED",
        submittedAt: now,
        supApprovedAt: now,
        supApprovedById: employeeId ?? null,
      },
    });

    await writeAuditLog({
      tenantId,
      actorId: employeeId,
      entityType: "PAY_PERIOD",
      entityId: payPeriodId,
      action: "BULK_SUP_APPROVE",
      changes: { after: { count: pending.length, source: "MANUAL_BULK" } },
    });

    revalidatePath("/payroll/pay-periods");
    return { submitted: pending.length };
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Auto-post all APPROVED leave requests that overlap the given pay period.
 * Called when a pay period is locked.
 */
async function autoPostApprovedLeave(
  payPeriod: { id: string; startDate: Date; endDate: Date; tenantId: string },
  actorId: string | null
) {
  const requests = await db.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      employee: { tenantId: payPeriod.tenantId },
      startDate: { lte: payPeriod.endDate },
      endDate: { gte: payPeriod.startDate },
    },
    select: { id: true },
  });

  for (const req of requests) {
    await db.leaveRequest.update({
      where: { id: req.id },
      data: { status: "POSTED", postedAt: new Date() },
    });

    await postLeaveUsage(req.id);

    await writeAuditLog({
      tenantId: payPeriod.tenantId,
      actorId,
      entityType: "LEAVE_REQUEST",
      entityId: req.id,
      action: "POSTED",
      changes: { before: "APPROVED", after: { status: "POSTED", source: "AUTO_LOCK", payPeriodId: payPeriod.id } },
    });
  }
}
