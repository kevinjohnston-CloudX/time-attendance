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
import { getPeriodContaining, generatePeriodsForTenant } from "@/lib/pay-period-utils";
import type { PayFrequency } from "@prisma/client";

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getPayPeriods = withRBAC("PAY_PERIOD_MANAGE", async ({ tenantId }, _input: void) => {
  return db.payPeriod.findMany({
    where: { tenantId: tenantId ?? undefined },
    orderBy: { startDate: "desc" },
    include: {
      timesheets: {
        select: { status: true },
      },
    },
  });
});

export const getPayPeriodDetail = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (
    _actor,
    input: { payPeriodId: string }
  ) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);

    const [payPeriod, validation] = await Promise.all([
      db.payPeriod.findUniqueOrThrow({
        where: { id: payPeriodId },
        include: {
          timesheets: {
            include: {
              employee: { include: { user: true } },
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
 * OPEN → READY.
 * Requires all timesheets to be PAYROLL_APPROVED with no unresolved exceptions.
 */
export const markPayPeriodReady = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (actor, input: { payPeriodId: string }) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);

    const payPeriod = await db.payPeriod.findUniqueOrThrow({
      where: { id: payPeriodId },
    });

    const transition = validatePayPeriodTransition(payPeriod.status, "MARK_READY");
    if (!transition.valid) throw new Error(transition.error);

    const validation = await validatePayPeriod(payPeriodId);
    if (!validation.isReady) {
      const count = validation.issues.length;
      throw new Error(
        `Pay period has ${count} outstanding issue${count === 1 ? "" : "s"} — resolve them before marking ready`
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

    const payPeriod = await db.payPeriod.findUniqueOrThrow({
      where: { id: payPeriodId },
      select: { status: true, startDate: true, endDate: true, tenantId: true },
    });

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

    const payPeriod = await db.payPeriod.findUniqueOrThrow({
      where: { id: payPeriodId },
    });

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
    return db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { payFrequency: true, payPeriodAnchorDate: true, name: true },
    });
  }
);

export const updateTenantSettings = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId }, input: { payFrequency: PayFrequency; payPeriodAnchorDate: string }) => {
    if (!tenantId) throw new Error("No tenant context");
    const anchor = new Date(input.payPeriodAnchorDate);
    if (isNaN(anchor.getTime())) throw new Error("Invalid anchor date");
    const updated = await db.tenant.update({
      where: { id: tenantId },
      data: { payFrequency: input.payFrequency, payPeriodAnchorDate: anchor },
    });
    revalidatePath("/admin/settings");
    return { payFrequency: updated.payFrequency, payPeriodAnchorDate: updated.payPeriodAnchorDate };
  }
);

export const generateNextPayPeriod = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId }, _input: void) => {
    if (!tenantId) throw new Error("No tenant context");

    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { payPeriodAnchorDate: true },
    });

    if (!tenant.payPeriodAnchorDate) {
      throw new Error("Configure a pay period anchor date in Company Settings first");
    }

    const created = await generatePeriodsForTenant(tenantId, 1);
    if (created === 0) throw new Error("That pay period already exists");

    revalidatePath("/payroll/pay-periods");
    revalidatePath("/admin/settings");
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
