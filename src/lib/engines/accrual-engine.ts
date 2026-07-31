import { getYear, differenceInMonths } from "date-fns";
import { db } from "@/lib/db";

/** Derive how many pay periods fit in a year from a single period's date range. */
function periodsPerYear(startDate: Date, endDate: Date): number {
  const lengthDays =
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  return Math.round(365 / lengthDays); // 14d → 26, 7d → 52, ~15d → 24
}

/**
 * Post per-pay-period accruals for every active employee × active leave type.
 * Called when a pay period is locked.
 *
 * Accrual rate priority:
 *   1. Employee's PTO policy override
 *   2. Site's PTO policy for this leave type
 *   3. Tenant default policy (isDefault = true)
 *   4. LeaveType.accrualRateMinutes flat fallback
 *
 * When a LeaveBalance row is created for the first time, the policy's
 * startingHours are credited as the initial balance.
 */
export async function postAccruals(payPeriodId: string): Promise<void> {
  const payPeriod = await db.payPeriod.findUniqueOrThrow({
    where: { id: payPeriodId },
  });

  const accrualYear = getYear(payPeriod.endDate);
  const ppy = periodsPerYear(payPeriod.startDate, payPeriod.endDate);

  const yearStart = new Date(`${accrualYear}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${accrualYear + 1}-01-01T00:00:00Z`);

  const [employees, leaveTypes, rules, siteLinks, empOverrides] = await Promise.all([
    db.employee.findMany({
      where: { isActive: true, tenantId: payPeriod.tenantId },
      select: { id: true, siteId: true, hireDate: true },
    }),
    db.leaveType.findMany({ where: { isActive: true, tenantId: payPeriod.tenantId } }),
    db.ptoPolicyRule.findMany({
      where: { ptoPolicy: { tenantId: payPeriod.tenantId, isActive: true } },
      include: { ptoPolicy: { select: { isDefault: true } } },
    }),
    db.sitePtoPolicy.findMany({ where: { site: { tenantId: payPeriod.tenantId } } }),
    db.employeePtoPolicyOverride.findMany({
      where: { employee: { tenantId: payPeriod.tenantId } },
      select: { employeeId: true, ptoPolicyId: true },
    }),
  ]);

  // Sum of ACCRUAL ledger entries already posted this year — used to enforce the annual cap
  const accrualSums = await db.leaveAccrualLedger.groupBy({
    by: ["employeeId", "leaveTypeId"],
    where: {
      action: "ACCRUAL",
      payPeriodEnd: { gte: yearStart, lt: yearEnd },
      employeeId: { in: employees.map((e) => e.id) },
    },
    _sum: { deltaMinutes: true },
  });

  // "employeeId:leaveTypeId" → total minutes already accrued this year
  const accrualSumMap = new Map(
    accrualSums.map((s) => [`${s.employeeId}:${s.leaveTypeId}`, s._sum.deltaMinutes ?? 0])
  );

  // ruleMap: "policyId:leaveTypeId" → sorted tier list (ascending minTenureMonths)
  const ruleMap = new Map<string, typeof rules>();
  for (const r of rules) {
    const k = `${r.ptoPolicyId}:${r.leaveTypeId}`;
    const list = ruleMap.get(k) ?? [];
    list.push(r);
    ruleMap.set(k, list);
  }
  for (const list of ruleMap.values()) list.sort((a, b) => a.minTenureMonths - b.minTenureMonths);
  const sitePolicyMap = new Map(
    siteLinks.map((s) => [`${s.siteId}:${s.leaveTypeId}`, s.ptoPolicyId])
  );
  const empOverrideMap = new Map(
    empOverrides.map((e) => [e.employeeId, e.ptoPolicyId])
  );
  // defaultPolicyId per leave type (from the isDefault policy's rules)
  const defaultPolicyByLeaveType = new Map<string, string>();
  for (const r of rules) {
    if (r.ptoPolicy.isDefault) defaultPolicyByLeaveType.set(r.leaveTypeId, r.ptoPolicyId);
  }

  for (const employee of employees) {
    for (const leaveType of leaveTypes) {
      // Resolve which policy applies, then find the matching tenure tier
      const policyId =
        empOverrideMap.get(employee.id) ??
        sitePolicyMap.get(`${employee.siteId}:${leaveType.id}`) ??
        defaultPolicyByLeaveType.get(leaveType.id);
      const tiers = policyId ? (ruleMap.get(`${policyId}:${leaveType.id}`) ?? []) : [];
      const tenureMonths = differenceInMonths(payPeriod.endDate, employee.hireDate);
      const rule = tiers.find(
        (t) =>
          t.minTenureMonths <= tenureMonths &&
          (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
      ) ?? null;

      // Carry-over: if this is the first accrual of the year, seed the opening balance
      // from the previous year's unused minutes (capped by carryOverHours; null = unlimited).
      const balanceKey = { employeeId: employee.id, leaveTypeId: leaveType.id, accrualYear };
      const existingThisYear = await db.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_accrualYear: balanceKey },
        select: { id: true },
      });

      let openingCarryOver = 0;
      if (!existingThisYear && rule) {
        const prevYear = await db.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_accrualYear: {
              employeeId: employee.id,
              leaveTypeId: leaveType.id,
              accrualYear: accrualYear - 1,
            },
          },
          select: { balanceMinutes: true },
        });
        if (prevYear && prevYear.balanceMinutes > 0) {
          const capMinutes = rule.carryOverHours != null ? rule.carryOverHours * 60 : null;
          openingCarryOver = capMinutes != null
            ? Math.min(prevYear.balanceMinutes, capMinutes)
            : prevYear.balanceMinutes;
        }
      }

      // Get or create the balance row for this employee/leaveType/year
      const existing = await db.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_accrualYear: balanceKey },
        update: {},
        create: {
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          accrualYear,
          balanceMinutes: openingCarryOver,
          usedMinutes: 0,
        },
      });

      // Write a carry-over ledger entry the first time this year's row is created
      if (!existingThisYear && openingCarryOver > 0) {
        await db.leaveAccrualLedger.create({
          data: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            action: "ADJUSTMENT",
            deltaMinutes: openingCarryOver,
            balanceAfter: openingCarryOver,
          },
        });
      }

      // Effective annual hours = base + longevity bonus (earnedHoursPerYear × complete years of tenure)
      const tenureYears = Math.floor(tenureMonths / 12);
      const effectiveAnnualHours = rule
        ? rule.annualHours + tenureYears * rule.earnedHoursPerYear
        : 0;

      // Compute per-period accrual rate in minutes
      let rate: number;
      const annualCapMinutes = effectiveAnnualHours > 0
        ? effectiveAnnualHours * 60
        : null;

      if (effectiveAnnualHours > 0) {
        rate = Math.round((effectiveAnnualHours * 60) / ppy);
      } else {
        // Flat LeaveType fallback (backward compat)
        rate = leaveType.accrualRateMinutes;
      }

      if (rate <= 0) continue;

      // Enforce annual cap — don't accrue beyond hoursPerYear for the year
      if (annualCapMinutes !== null) {
        const alreadyAccrued = accrualSumMap.get(`${employee.id}:${leaveType.id}`) ?? 0;
        if (alreadyAccrued >= annualCapMinutes) continue;
        rate = Math.min(rate, annualCapMinutes - alreadyAccrued);
      }

      const currentBalance = existing.balanceMinutes;
      const cap = leaveType.maxBalanceMinutes;
      const newBalance = cap !== null
        ? Math.min(currentBalance + rate, cap)
        : currentBalance + rate;

      const actualDelta = newBalance - currentBalance;
      if (actualDelta <= 0) continue;

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

  const delta = -request.durationMinutes;
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

/**
 * Reverse a previously posted leave debit when a request is cancelled.
 * No-ops if no USAGE ledger entry exists for this request (i.e. it was never debited).
 */
export async function reverseLeaveUsage(leaveRequestId: string): Promise<void> {
  const usageEntry = await db.leaveAccrualLedger.findFirst({
    where: { leaveRequestId, action: "USAGE" },
  });
  if (!usageEntry) return;

  const accrualYear = getYear(
    (await db.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId } })).startDate
  );

  const balance = await db.leaveBalance.findUniqueOrThrow({
    where: {
      employeeId_leaveTypeId_accrualYear: {
        employeeId: usageEntry.employeeId,
        leaveTypeId: usageEntry.leaveTypeId,
        accrualYear,
      },
    },
  });

  const reversal = -usageEntry.deltaMinutes; // deltaMinutes was negative, reversal is positive
  const newBalance = balance.balanceMinutes + reversal;

  await db.$transaction([
    db.leaveBalance.update({
      where: { id: balance.id },
      data: {
        balanceMinutes: newBalance,
        usedMinutes: { decrement: reversal },
      },
    }),
    db.leaveAccrualLedger.create({
      data: {
        employeeId: usageEntry.employeeId,
        leaveTypeId: usageEntry.leaveTypeId,
        action: "ADJUSTMENT",
        deltaMinutes: reversal,
        balanceAfter: newBalance,
        leaveRequestId,
      },
    }),
  ]);
}
