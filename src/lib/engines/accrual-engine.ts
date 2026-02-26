import { getYear } from "date-fns";
import { db } from "@/lib/db";

/** Derive how many pay periods fit in a year from a single period's date range. */
function periodsPerYear(startDate: Date, endDate: Date): number {
  const lengthDays =
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  return Math.round(365 / lengthDays); // 14d → 26, 7d → 52, ~15d → 24
}

const MINUTES_PER_DAY = 8 * 60; // 480 min = 1 work day

/**
 * Post per-pay-period accruals for every active employee × active leave type.
 * Called when a pay period is locked.
 *
 * Per-period accrual rate is determined by:
 *   1. If the employee has `annualDaysEntitled` set on their LeaveBalance →
 *      (annualDays × 480) / periodsPerYear
 *   2. Otherwise fall back to the LeaveType's global `accrualRateMinutes`.
 */
export async function postAccruals(payPeriodId: string): Promise<void> {
  const payPeriod = await db.payPeriod.findUniqueOrThrow({
    where: { id: payPeriodId },
  });

  const accrualYear = getYear(payPeriod.endDate);
  const ppy = periodsPerYear(payPeriod.startDate, payPeriod.endDate);

  const [employees, leaveTypes] = await Promise.all([
    db.employee.findMany({ where: { isActive: true }, select: { id: true } }),
    db.leaveType.findMany({ where: { isActive: true } }),
  ]);

  for (const employee of employees) {
    for (const leaveType of leaveTypes) {
      // Get or create the balance row
      const existing = await db.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_accrualYear: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            accrualYear,
          },
        },
        update: {},
        create: {
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          accrualYear,
          balanceMinutes: 0,
          usedMinutes: 0,
        },
      });

      // Compute per-period rate
      let rate: number;
      if (existing.annualDaysEntitled != null) {
        // Employee-specific: annual days → minutes per period
        rate = Math.round((existing.annualDaysEntitled * MINUTES_PER_DAY) / ppy);
      } else {
        // Leave type default (already per-period)
        rate = leaveType.accrualRateMinutes;
      }

      if (rate <= 0) continue; // no accrual for this combo

      const currentBalance = existing.balanceMinutes;
      const cap = leaveType.maxBalanceMinutes;

      const newBalance = cap !== null
        ? Math.min(currentBalance + rate, cap)
        : currentBalance + rate;

      const actualDelta = newBalance - currentBalance;
      if (actualDelta <= 0) continue; // already at cap

      await db.$transaction([
        db.leaveBalance.update({
          where: { id: existing.id },
          data: { balanceMinutes: newBalance },
        }),
        db.leaveAccrualLedger.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            action: "ACCRUAL",
            deltaMinutes: actualDelta,
            balanceAfter: newBalance,
            payPeriodEnd: payPeriod.endDate,
          },
        }),
      ]);
    }
  }
}

/**
 * Debit leave balance when a leave request is POSTED.
 * Appends an immutable USAGE ledger entry.
 */
export async function postLeaveUsage(leaveRequestId: string): Promise<void> {
  const request = await db.leaveRequest.findUniqueOrThrow({
    where: { id: leaveRequestId },
  });

  const accrualYear = getYear(request.startDate);

  const balance = await db.leaveBalance.findUniqueOrThrow({
    where: {
      employeeId_leaveTypeId_accrualYear: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        accrualYear,
      },
    },
  });

  const delta = -request.durationMinutes; // negative = debit
  const newBalance = balance.balanceMinutes + delta;

  await db.$transaction([
    db.leaveBalance.update({
      where: { id: balance.id },
      data: {
        balanceMinutes: newBalance,
        usedMinutes: { increment: request.durationMinutes },
      },
    }),
    db.leaveAccrualLedger.create({
      data: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        action: "USAGE",
        deltaMinutes: delta,
        balanceAfter: newBalance,
        leaveRequestId: request.id,
      },
    }),
  ]);
}
