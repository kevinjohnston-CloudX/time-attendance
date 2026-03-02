"use server";

import { revalidatePath } from "next/cache";
import { addDays, differenceInDays, startOfMonth, endOfMonth } from "date-fns";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { validatePayPeriodTransition } from "@/lib/state-machines/pay-period-state";
import { validatePayPeriod } from "@/lib/engines/validation-engine";
import {
  payPeriodIdSchema,
  reopenPayPeriodSchema,
} from "@/lib/validators/pay-period.schema";
import { writeAuditLog } from "@/lib/audit/logger";
import { postAccruals } from "@/lib/engines/accrual-engine";
import type { PayFrequency } from "@prisma/client";

// ─── Pay-period date helpers ──────────────────────────────────────────────────

/**
 * Given a frequency + anchor, return the pay period that contains `date`.
 * For SEMIMONTHLY / MONTHLY the anchor is unused (calendar-based).
 */
function getPeriodContaining(
  frequency: PayFrequency,
  anchor: Date,
  date: Date
): { startDate: Date; endDate: Date } {
  switch (frequency) {
    case "WEEKLY": {
      const n = Math.floor(differenceInDays(date, anchor) / 7);
      const start = addDays(anchor, n * 7);
      return { startDate: start, endDate: addDays(start, 6) };
    }
    case "BIWEEKLY": {
      const n = Math.floor(differenceInDays(date, anchor) / 14);
      const start = addDays(anchor, n * 14);
      return { startDate: start, endDate: addDays(start, 13) };
    }
    case "SEMIMONTHLY": {
      if (date.getDate() <= 15) {
        return {
          startDate: new Date(date.getFullYear(), date.getMonth(), 1),
          endDate: new Date(date.getFullYear(), date.getMonth(), 15),
        };
      }
      return {
        startDate: new Date(date.getFullYear(), date.getMonth(), 16),
        endDate: endOfMonth(date),
      };
    }
    case "MONTHLY":
      return { startDate: startOfMonth(date), endDate: endOfMonth(date) };
  }
}

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
 * Also transitions all PAYROLL_APPROVED timesheets to LOCKED.
 */
export const lockPayPeriod = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (actor, input: { payPeriodId: string }) => {
    const { payPeriodId } = payPeriodIdSchema.parse(input);

    const payPeriod = await db.payPeriod.findUniqueOrThrow({
      where: { id: payPeriodId },
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
    // Run after the transaction so timesheets are already locked.
    await postAccruals(payPeriodId);

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
  async ({ tenantId, employeeId }, _input: void) => {
    if (!tenantId) throw new Error("No tenant context");

    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { payFrequency: true, payPeriodAnchorDate: true },
    });

    if (!tenant.payPeriodAnchorDate) {
      throw new Error("Configure a pay period anchor date in Company Settings first");
    }

    const anchor = tenant.payPeriodAnchorDate;
    const last = await db.payPeriod.findFirst({
      where: { tenantId },
      orderBy: { endDate: "desc" },
    });

    const referenceDate = last ? addDays(last.endDate, 1) : new Date();
    const { startDate, endDate } = getPeriodContaining(tenant.payFrequency, anchor, referenceDate);

    const existing = await db.payPeriod.findFirst({
      where: { tenantId, startDate, endDate },
    });
    if (existing) throw new Error("That pay period already exists");

    const period = await db.payPeriod.create({
      data: { tenantId, startDate, endDate, status: "OPEN" },
    });

    await writeAuditLog({
      tenantId,
      actorId: employeeId,
      entityType: "PAY_PERIOD",
      entityId: period.id,
      action: "CREATE",
      changes: { after: { startDate, endDate, frequency: tenant.payFrequency } },
    });

    revalidatePath("/payroll/pay-periods");
    revalidatePath("/admin/settings");
    return period;
  }
);
