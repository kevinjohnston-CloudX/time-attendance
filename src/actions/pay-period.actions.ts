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
import { postAccruals } from "@/lib/engines/accrual-engine";

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getPayPeriods = withRBAC("PAY_PERIOD_MANAGE", async (_actor, _input: void) => {
  return db.payPeriod.findMany({
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
