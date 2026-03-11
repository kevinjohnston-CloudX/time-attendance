import { getYear, differenceInMonths } from "date-fns";
import { db } from "@/lib/db";

/** Derive how many pay periods fit in a year from a single period's date range. */
function periodsPerYear(startDate: Date, endDate: Date): number {
  const lengthDays =
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  return Math.round(365 / lengthDays); // 14d → 26, 7d → 52, ~15d → 24
}

const MINUTES_PER_DAY = 8 * 60; // 480 min = 1 work day

/** Find the matching tenure band for a given tenure in months. */
function matchBand(
  bands: { minTenureMonths: number; maxTenureMonths: number | null; annualDays: number }[],
  tenureMonths: number
) {
  return bands.find(
    (b) =>
      b.minTenureMonths <= tenureMonths &&
      (b.maxTenureMonths === null || tenureMonths < b.maxTenureMonths)
  );
}

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

  const [employees, leaveTypes, allBands, siteLinks, empOverrides] = await Promise.all([
    db.employee.findMany({
      where: { isActive: true, tenantId: payPeriod.tenantId },
      select: { id: true, siteId: true, hireDate: true },
    }),
    db.leaveType.findMany({ where: { isActive: true, tenantId: payPeriod.tenantId } }),
    db.ptoPolicyBand.findMany({
      where: { ptoPolicy: { tenantId: payPeriod.tenantId, isActive: true } },
      include: { ptoPolicy: { select: { isDefault: true } } },
    }),
    db.sitePtoPolicy.findMany({ where: { site: { tenantId: payPeriod.tenantId } } }),
    db.employeePtoPolicyOverride.findMany({
      where: { employee: { tenantId: payPeriod.tenantId } },
    }),
  ]);

  // Build lookup maps for policy resolution
  const bandMap = new Map<string, typeof allBands>();
  for (const b of allBands) {
    const k = `${b.ptoPolicyId}:${b.leaveTypeId}`;
    bandMap.set(k, [...(bandMap.get(k) ?? []), b]);
  }
  const sitePolicyMap = new Map(
    siteLinks.map((s) => [`${s.siteId}:${s.leaveTypeId}`, s.ptoPolicyId])
  );
  const empOverrideMap = new Map(
    empOverrides.map((e) => [`${e.employeeId}:${e.leaveTypeId}`, e.ptoPolicyId])
  );
  const defaultPolicyMap = new Map<string, string>();
  for (const b of allBands) {
    if (b.ptoPolicy.isDefault) defaultPolicyMap.set(b.leaveTypeId, b.ptoPolicyId);
  }

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

      // Compute per-period rate — 5-level priority chain
      let rate: number;
      if (existing.annualDaysEntitled != null) {
        // Level 1 — manual per-employee annual override
        rate = Math.round((existing.annualDaysEntitled * MINUTES_PER_DAY) / ppy);
      } else {
        const tenureMonths = differenceInMonths(payPeriod.endDate, employee.hireDate);
        const candidates = [
          empOverrideMap.get(`${employee.id}:${leaveType.id}`),     // Level 2 — employee override
          sitePolicyMap.get(`${employee.siteId}:${leaveType.id}`),  // Level 3 — site policy
          defaultPolicyMap.get(leaveType.id),                        // Level 4 — tenant default policy
        ];
        let policyRate: number | null = null;
        for (const policyId of candidates) {
          if (!policyId) continue;
          const band = matchBand(bandMap.get(`${policyId}:${leaveType.id}`) ?? [], tenureMonths);
          if (band) {
            policyRate = Math.round((band.annualDays * MINUTES_PER_DAY) / ppy);
            break;
          }
        }
        // Level 5 — flat LeaveType.accrualRateMinutes fallback (backward compat)
        rate = policyRate ?? leaveType.accrualRateMinutes;
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
