import { db } from "@/lib/db";
import { validatePayPeriodTransition } from "@/lib/state-machines/pay-period-state";
import { writeAuditLog } from "@/lib/audit/logger";
import { postAccruals, postLeaveUsage } from "@/lib/engines/accrual-engine";

/**
 * Locks a pay period and every timecard in it, then posts the period's
 * accruals and its approved leave. Shared by the Pay Periods Lock button and
 * Run Payroll, so both lock the same way. The caller checks the permission.
 * `keepOpen` timecards stay unlocked inside the locked period, as an unlocked
 * timecard does: Run Payroll uses it for the people it left out for a missed
 * punch, so they can be corrected, locked and run later.
 */
export async function lockPeriod(
  payPeriodId: string,
  actor: { tenantId: string | null; employeeId: string | null },
  keepOpen: string[] = [],
): Promise<void> {
  if (!actor.tenantId) throw new Error("This pay period isn't available. Reload the page and try again.");
  const payPeriod = await db.payPeriod.findFirst({ where: { id: payPeriodId, tenantId: actor.tenantId } });
  if (!payPeriod) throw new Error("This pay period isn't available. Reload the page and try again.");

  const transition = validatePayPeriodTransition(payPeriod.status, "LOCK");
  if (!transition.valid) throw new Error(transition.error);

  await db.$transaction([
    db.payPeriod.update({ where: { id: payPeriodId }, data: { status: transition.newStatus } }),
    db.timesheet.updateMany({
      where: { payPeriodId, status: { not: "LOCKED" }, ...(keepOpen.length ? { id: { notIn: keepOpen } } : {}) },
      data: { status: "LOCKED", lockedAt: new Date() },
    }),
  ]);

  await writeAuditLog({
    tenantId: actor.tenantId,
    actorId: actor.employeeId,
    entityType: "PAY_PERIOD",
    entityId: payPeriodId,
    action: "LOCK",
    changes: {
      before: payPeriod.status,
      after: keepOpen.length ? { status: transition.newStatus, timecardsLeftOpen: keepOpen.length } : transition.newStatus,
    },
  });

  await postAccruals(payPeriodId);
  // The period's own people: every pay group has a period on the same dates,
  // and locking one posted the whole company's approved leave.
  const people = await db.timesheet.findMany({ where: { payPeriodId }, select: { employeeId: true }, distinct: ["employeeId"] });
  await autoPostApprovedLeave(payPeriod, actor.employeeId, people.map((p) => p.employeeId));
}

/**
 * Locks these timecards and no others, as Run Payroll does for the ones in
 * its file, and posts accruals and approved leave for their people only. A
 * period with every timecard locked is then locked itself; one with any left
 * open stays open for the next run. Locking whole periods locked people
 * outside the file: US HR pays the sites and Rey 11 in separate runs, and
 * both are in NJ Exempt - Autopay, so the first run locked the other's
 * timecards. Returns how many periods it locked.
 */
export async function lockTimecards(
  timesheetIds: string[],
  actor: { tenantId: string | null; employeeId: string | null },
): Promise<number> {
  if (!actor.tenantId) throw new Error("This pay period isn't available. Reload the page and try again.");
  if (timesheetIds.length === 0) return 0;
  const sheets = await db.timesheet.findMany({
    where: { id: { in: timesheetIds }, status: { not: "LOCKED" }, payPeriod: { tenantId: actor.tenantId } },
    select: { id: true, employeeId: true, payPeriodId: true },
  });
  const byPeriod = new Map<string, typeof sheets>();
  for (const s of sheets) byPeriod.set(s.payPeriodId, [...(byPeriod.get(s.payPeriodId) ?? []), s]);

  let periodsLocked = 0;
  for (const [payPeriodId, mine] of byPeriod) {
    const payPeriod = await db.payPeriod.findUniqueOrThrow({ where: { id: payPeriodId } });
    const employeeIds = [...new Set(mine.map((s) => s.employeeId))];
    await db.timesheet.updateMany({
      where: { id: { in: mine.map((s) => s.id) }, status: { not: "LOCKED" } },
      data: { status: "LOCKED", lockedAt: new Date() },
    });
    const stillOpen = await db.timesheet.count({ where: { payPeriodId, status: { not: "LOCKED" } } });
    const transition = validatePayPeriodTransition(payPeriod.status, "LOCK");
    const closes = stillOpen === 0 && transition.valid;
    if (closes) await db.payPeriod.update({ where: { id: payPeriodId }, data: { status: transition.newStatus } });

    await writeAuditLog({
      tenantId: actor.tenantId,
      actorId: actor.employeeId,
      entityType: "PAY_PERIOD",
      entityId: payPeriodId,
      action: closes ? "LOCK" : "TIMECARDS_LOCKED",
      changes: {
        before: payPeriod.status,
        after: { status: closes ? transition.newStatus : payPeriod.status, timecardsLocked: mine.length, timecardsStillOpen: stillOpen },
      },
    });

    await postAccruals(payPeriodId, employeeIds);
    await autoPostApprovedLeave(payPeriod, actor.employeeId, employeeIds);
    if (closes) periodsLocked++;
  }
  return periodsLocked;
}

/** Posts these people's APPROVED leave requests that overlap the period. */
async function autoPostApprovedLeave(
  payPeriod: { id: string; startDate: Date; endDate: Date; tenantId: string },
  actorId: string | null,
  employeeIds: string[],
) {
  const requests = await db.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      employeeId: { in: employeeIds },
      employee: { tenantId: payPeriod.tenantId },
      startDate: { lte: payPeriod.endDate },
      endDate: { gte: payPeriod.startDate },
    },
    select: { id: true },
  });

  for (const req of requests) {
    // Posted and debited together; one HR already debited at approval is not debited again.
    await db.$transaction(async (tx) => {
      await tx.leaveRequest.update({ where: { id: req.id }, data: { status: "POSTED", postedAt: new Date() } });
      await postLeaveUsage(req.id, tx);
    });
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
