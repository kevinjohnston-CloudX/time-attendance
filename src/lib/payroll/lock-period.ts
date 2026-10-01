import { db } from "@/lib/db";
import { validatePayPeriodTransition } from "@/lib/state-machines/pay-period-state";
import { writeAuditLog } from "@/lib/audit/logger";
import { postAccruals, postLeaveUsage } from "@/lib/engines/accrual-engine";

/**
 * Locks a pay period and every timecard in it, then posts the period's
 * accruals and its approved leave. Shared by the Pay Periods Lock button and
 * Run Payroll, so both lock the same way. The caller checks the permission.
 */
export async function lockPeriod(
  payPeriodId: string,
  actor: { tenantId: string | null; employeeId: string | null },
): Promise<void> {
  if (!actor.tenantId) throw new Error("Pay period not found");
  const payPeriod = await db.payPeriod.findFirst({ where: { id: payPeriodId, tenantId: actor.tenantId } });
  if (!payPeriod) throw new Error("Pay period not found");

  const transition = validatePayPeriodTransition(payPeriod.status, "LOCK");
  if (!transition.valid) throw new Error(transition.error);

  await db.$transaction([
    db.payPeriod.update({ where: { id: payPeriodId }, data: { status: transition.newStatus } }),
    db.timesheet.updateMany({
      where: { payPeriodId, status: { not: "LOCKED" } },
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

  await postAccruals(payPeriodId);
  await autoPostApprovedLeave(payPeriod, actor.employeeId);
}

/** Posts every APPROVED leave request that overlaps the period. */
async function autoPostApprovedLeave(
  payPeriod: { id: string; startDate: Date; endDate: Date; tenantId: string },
  actorId: string | null,
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
    await db.leaveRequest.update({ where: { id: req.id }, data: { status: "POSTED", postedAt: new Date() } });
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
