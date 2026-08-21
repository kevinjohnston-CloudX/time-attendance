import { getYear, differenceInMonths, addDays } from "date-fns";
import { AccrualPostingFreq, AccrualRateMode, ServiceMonthBasis } from "@prisma/client";
import { db } from "@/lib/db";
import { parseUtcDate } from "@/lib/utils/date";

/** Derive how many pay periods fit in a year from a single period's date range. */
function periodsPerYear(startDate: Date, endDate: Date): number {
  const lengthDays =
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  return Math.round(365 / lengthDays); // 14d → 26, 7d → 52, ~15d → 24
}

/**
 * Returns how many times the given frequency fires within this pay period.
 * 0 = don't post. >1 is possible for DAILY/WEEKLY/BI_WEEKLY (multiple cycles per period).
 * ppStart and ppEndIncl are LOCAL midnight dates (from parseUtcDate).
 * cycleAnchor is the reference date for cycle-based frequencies (BI_WEEKLY, WEEKLY, DAILY, ANNUALLY).
 *   Comes from ptoPolicy.postingAnchorDate when set; falls back to the employee's hire-basis date.
 * hireAnchor is always the employee's hire-basis date and is used only for ANNUALLY_HIRE.
 */
function postingTriggered(
  freq: AccrualPostingFreq,
  fixedMonth: number | null,
  fixedDay: number | null,
  ppStart: Date,
  ppEndIncl: Date,
  cycleAnchor: Date,
  hireAnchor: Date
): number {
  /** Days from a to b (positive if b > a). */
  function daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / 86_400_000);
  }

  /** Count how many multiples of `interval` fall in [lo, hi] where lo/hi are days-since-cycleAnchor. */
  function countCycles(interval: number): number {
    const daysToEnd = daysBetween(cycleAnchor, ppEndIncl);
    if (daysToEnd < 0) return 0;
    const daysToStart = daysBetween(cycleAnchor, ppStart);
    const lo = Math.max(0, daysToStart);
    const firstFire = Math.ceil(lo / interval) * interval;
    if (firstFire > daysToEnd) return 0;
    return Math.floor((daysToEnd - firstFire) / interval) + 1;
  }

  /** Check if the 1st of each listed month (0-based) falls in the period. Returns 0 or 1. */
  function anyFirst(months: number[]): number {
    for (const year of [ppStart.getFullYear(), ppStart.getFullYear() + 1]) {
      for (const m of months) {
        const d = new Date(year, m, 1);
        if (d >= ppStart && d <= ppEndIncl) return 1;
      }
    }
    return 0;
  }

  switch (freq) {
    case "PER_PAY_PERIOD":
      return 1;

    case "DAILY":
      // Count calendar days in [max(basisDate, ppStart), ppEndIncl]
      return countCycles(1);

    case "WEEKLY":
      return countCycles(7);

    case "BI_WEEKLY":
      return countCycles(14);

    case "SEMI_MONTHLY": {
      // Fires on 1st and 15th of each calendar month — up to 1 per pay period
      for (const day of [1, 15]) {
        const d1 = new Date(ppStart.getFullYear(), ppStart.getMonth(), day);
        if (d1 >= ppStart && d1 <= ppEndIncl) return 1;
        const d2 = new Date(ppStart.getFullYear(), ppStart.getMonth() + 1, day);
        if (d2 >= ppStart && d2 <= ppEndIncl) return 1;
      }
      return 0;
    }

    case "MONTHLY":
      return anyFirst([ppStart.getMonth(), ppStart.getMonth() + 1]);

    case "EVERY_2_MONTHS":
      return anyFirst([0, 2, 4, 6, 8, 10]);

    case "QUARTERLY":
      return anyFirst([0, 3, 6, 9]);

    case "EVERY_4_MONTHS":
      return anyFirst([0, 4, 8]);

    case "SEMI_ANNUALLY":
      return anyFirst([0, 6]);

    case "ANNUALLY":
    case "ANNUALLY_HIRE": {
      // ANNUALLY fires on the policy cycle-anchor date each year.
      // ANNUALLY_HIRE fires on each employee's individual hire-date anniversary.
      const anchor = freq === "ANNUALLY_HIRE" ? hireAnchor : cycleAnchor;
      for (const year of [ppStart.getFullYear(), ppStart.getFullYear() + 1]) {
        const anniversary = new Date(year, anchor.getMonth(), anchor.getDate());
        if (anniversary >= ppStart && anniversary <= ppEndIncl) return 1;
      }
      return 0;
    }

    case "ANNUALLY_FIXED": {
      if (fixedMonth == null || fixedDay == null) return 0;
      for (const year of [ppStart.getFullYear(), ppStart.getFullYear() + 1]) {
        const target = new Date(year, fixedMonth - 1, fixedDay);
        if (target >= ppStart && target <= ppEndIncl) return 1;
      }
      return 0;
    }
  }
}

/**
 * Returns the approximate cycle length in days for a posting frequency.
 * Used to interpolate daily earned amounts between actual postings.
 * Returns 0 for PER_PAY_PERIOD (variable interval — no interpolation possible).
 */
function freqIntervalDays(freq: AccrualPostingFreq, lastPostingDate: Date): number {
  switch (freq) {
    case "DAILY":          return 1;
    case "WEEKLY":         return 7;
    case "BI_WEEKLY":      return 14;
    case "SEMI_MONTHLY":   return 15;
    case "MONTHLY": {
      // Actual days in the month of the last posting so the fraction is precise
      const d = lastPostingDate;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    }
    case "EVERY_2_MONTHS": return 61;
    case "QUARTERLY":      return 91;
    case "EVERY_4_MONTHS": return 122;
    case "SEMI_ANNUALLY":  return 183;
    case "ANNUALLY":
    case "ANNUALLY_HIRE":
    case "ANNUALLY_FIXED": return 365;
    default:               return 0;
  }
}

/** Compute per-posting rate in minutes.
 *  PER_POSTING mode: effectiveHours IS the per-posting amount — no division needed.
 *  YEARLY mode: divide annual total by the appropriate number of postings.
 */
function computeRate(
  freq: AccrualPostingFreq,
  rateMode: AccrualRateMode,
  effectiveHours: number,
  ppy: number
): number {
  if (rateMode === "PER_POSTING") {
    return Math.round(effectiveHours * 60);
  }
  const annualMins = effectiveHours * 60;
  switch (freq) {
    case "PER_PAY_PERIOD":  return Math.round(annualMins / ppy);
    case "DAILY":           return Math.round(annualMins / 365);
    case "WEEKLY":          return Math.round(annualMins / 52);
    case "BI_WEEKLY":       return Math.round(annualMins / 26);
    case "SEMI_MONTHLY":    return Math.round(annualMins / 24);
    case "MONTHLY":         return Math.round(annualMins / 12);
    case "EVERY_2_MONTHS":  return Math.round(annualMins / 6);
    case "QUARTERLY":       return Math.round(annualMins / 4);
    case "EVERY_4_MONTHS":  return Math.round(annualMins / 3);
    case "SEMI_ANNUALLY":   return Math.round(annualMins / 2);
    case "ANNUALLY":
    case "ANNUALLY_HIRE":
    case "ANNUALLY_FIXED":  return annualMins;
  }
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

  const ppStart   = parseUtcDate(payPeriod.startDate);
  const ppEndIncl = addDays(parseUtcDate(payPeriod.endDate), -1);

  const yearStart = new Date(`${accrualYear}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${accrualYear + 1}-01-01T00:00:00Z`);

  const [employees, leaveTypes, rules, siteLinks, catPolicyLinks] = await Promise.all([
    db.employee.findMany({
      where: { isActive: true, tenantId: payPeriod.tenantId },
      select: {
        id: true, siteId: true, payCategoryId: true, hireDate: true,
        adjustedHireDate: true, titleChangeDate: true,
        orientationDate: true, userDate2: true,
      },
    }),
    db.leaveType.findMany({ where: { isActive: true, tenantId: payPeriod.tenantId } }),
    db.ptoPolicyRule.findMany({
      where: { ptoPolicy: { tenantId: payPeriod.tenantId, isActive: true } },
      include: {
        ptoPolicy: {
          select: {
            isDefault:                  true,
            rateMode:                   true,
            serviceMonthBasis:          true,
            postingAnchorDate:          true,
            posting1Freq:               true,
            posting1Month:              true,
            posting1Day:                true,
            dualPosting:                true,
            posting2Freq:               true,
            posting2Month:              true,
            posting2Day:                true,
            balanceReset:               true,
            resetMonth:                 true,
            resetDay:                   true,
            carryOverEnabled:           true,
            carryOverRespectMaxBalance: true,
          },
        },
      },
    }),
    db.sitePtoPolicy.findMany({ where: { site: { tenantId: payPeriod.tenantId } } }),
    db.payCategoryPtoPolicy.findMany({
      where: { payCategory: { tenantId: payPeriod.tenantId } },
      include: { ptoPolicy: { select: { id: true, rules: { select: { leaveTypeId: true } } } } },
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

  // Employees whose balance was already reset this year — prevents double-reset on re-run
  const yearResets = await db.leaveAccrualLedger.findMany({
    where: {
      action: "BALANCE_RESET",
      payPeriodEnd: { gte: yearStart, lt: yearEnd },
      employeeId: { in: employees.map((e) => e.id) },
    },
    select: { employeeId: true, leaveTypeId: true },
  });
  const alreadyResetThisYear = new Set(
    yearResets.map((r) => `${r.employeeId}:${r.leaveTypeId}`)
  );

  // ruleMap: "policyId:leaveTypeId" → sorted tier list (ascending minTenureMonths)
  const ruleMap = new Map<string, typeof rules>();
  // policyConfigMap: policyId → posting schedule config
  const policyConfigMap = new Map<string, (typeof rules)[number]["ptoPolicy"]>();
  for (const r of rules) {
    const k = `${r.ptoPolicyId}:${r.leaveTypeId}`;
    const list = ruleMap.get(k) ?? [];
    list.push(r);
    ruleMap.set(k, list);
    if (!policyConfigMap.has(r.ptoPolicyId)) {
      policyConfigMap.set(r.ptoPolicyId, r.ptoPolicy);
    }
  }
  for (const list of ruleMap.values()) list.sort((a, b) => a.minTenureMonths - b.minTenureMonths);
  const sitePolicyMap = new Map(
    siteLinks.map((s) => [`${s.siteId}:${s.leaveTypeId}`, s.ptoPolicyId])
  );
  // payCategoryId:leaveTypeId → ptoPolicyId (first policy in category that covers this leave type)
  const catPolicyMap = new Map<string, string>();
  for (const link of catPolicyLinks) {
    for (const rule of link.ptoPolicy.rules) {
      const k = `${link.payCategoryId}:${rule.leaveTypeId}`;
      if (!catPolicyMap.has(k)) catPolicyMap.set(k, link.ptoPolicyId);
    }
  }
  // defaultPolicyId per leave type (from the isDefault policy's rules)
  const defaultPolicyByLeaveType = new Map<string, string>();
  for (const r of rules) {
    if (r.ptoPolicy.isDefault) defaultPolicyByLeaveType.set(r.leaveTypeId, r.ptoPolicyId);
  }

  for (const employee of employees) {
    for (const leaveType of leaveTypes) {
      // Resolve which policy applies, then find the matching tenure tier
      const policyId =
        (employee.payCategoryId ? catPolicyMap.get(`${employee.payCategoryId}:${leaveType.id}`) : undefined) ??
        sitePolicyMap.get(`${employee.siteId}:${leaveType.id}`) ??
        defaultPolicyByLeaveType.get(leaveType.id);
      const tiers = policyId ? (ruleMap.get(`${policyId}:${leaveType.id}`) ?? []) : [];

      // Resolve the basis date used for tenure and annual-hire triggers
      const pConfig = policyId ? policyConfigMap.get(policyId) : null;
      const basis: ServiceMonthBasis = pConfig?.serviceMonthBasis ?? "HIRE_DATE";
      const basisRaw =
        basis === "ADJUSTED_HIRE_DATE" ? (employee.adjustedHireDate ?? employee.hireDate) :
        basis === "TITLE_CHANGE_DATE"  ? (employee.titleChangeDate  ?? employee.hireDate) :
        basis === "ORIENTATION_DATE"   ? (employee.orientationDate  ?? employee.hireDate) :
        basis === "USER_DATE_2"        ? (employee.userDate2        ?? employee.hireDate) :
        employee.hireDate;
      const empBasisDate = parseUtcDate(basisRaw);
      // Cycle anchor: use the policy's postingAnchorDate when set (all employees share the same
      // cycle phase), otherwise fall back to the individual hire-basis date.
      const cycleAnchor = pConfig?.postingAnchorDate ? parseUtcDate(pConfig.postingAnchorDate) : empBasisDate;

      // Don't post for periods that end before the employee's basis date.
      if (ppEndIncl < empBasisDate) continue;

      const tenureMonths = differenceInMonths(payPeriod.endDate, basisRaw);
      const rule = tiers.find(
        (t) =>
          t.minTenureMonths <= tenureMonths &&
          (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
      ) ?? null;

      // Effective annual hours = base + longevity bonus (earnedHoursPerYear × complete years of tenure)
      const tenureYears = Math.floor(tenureMonths / 12);
      const effectiveAnnualHours = rule
        ? rule.annualHours + tenureYears * rule.earnedHoursPerYear
        : 0;

      // Policies with a non-PER_PAY_PERIOD schedule are handled by runDailyAccruals — skip here.
      if (effectiveAnnualHours > 0 && pConfig && pConfig.posting1Freq !== "PER_PAY_PERIOD") continue;

      // Check whether this pay period triggers a posting under the policy's schedule.
      // Flat-fallback accruals (effectiveAnnualHours === 0) always post per pay period.
      const rateMode: AccrualRateMode = pConfig?.rateMode ?? "YEARLY";
      let activeFreq: AccrualPostingFreq = "PER_PAY_PERIOD";

      let postingCount = 1;
      if (effectiveAnnualHours > 0 && pConfig) {
        const p1count = postingTriggered(
          pConfig.posting1Freq, pConfig.posting1Month, pConfig.posting1Day,
          ppStart, ppEndIncl, cycleAnchor, empBasisDate
        );
        const p2count =
          pConfig.dualPosting && pConfig.posting2Freq != null
            ? postingTriggered(
                pConfig.posting2Freq, pConfig.posting2Month, pConfig.posting2Day,
                ppStart, ppEndIncl, cycleAnchor, empBasisDate
              )
            : 0;

        if (!p1count && !p2count) continue;
        activeFreq = p1count ? pConfig.posting1Freq : pConfig.posting2Freq!;
        postingCount = p1count || p2count;
      }

      // Check if the reset date falls within this pay period
      const isResetPeriod = !!(
        pConfig?.balanceReset &&
        pConfig.resetMonth != null && pConfig.resetDay != null &&
        [ppStart.getFullYear(), ppEndIncl.getFullYear()].some((yr) => {
          const d = new Date(yr, pConfig.resetMonth! - 1, pConfig.resetDay!);
          return d >= ppStart && d <= ppEndIncl;
        })
      );

      // Carry-over: if this is the first accrual of the year, seed the opening balance
      // from the previous year's unused minutes (capped by carryOverHours; null = unlimited).
      // Skipped on reset periods — the balance resets to 0 so carry-over is irrelevant.
      const balanceKey = { employeeId: employee.id, leaveTypeId: leaveType.id, accrualYear };
      const existingThisYear = await db.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_accrualYear: balanceKey },
        select: { id: true },
      });

      let openingCarryOver = 0;
      if (!existingThisYear && rule && !isResetPeriod) {
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
        if (prevYear && prevYear.balanceMinutes > 0 && pConfig?.carryOverEnabled !== false) {
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

      // Balance reset: zero the balance, then restore carry-over up to the policy limit.
      // e.g. carry-over = 5 hrs → employee finishes the reset with 5 hrs available.
      // Only fires once per year (alreadyResetThisYear prevents double-reset on re-run).
      const resetKey = `${employee.id}:${leaveType.id}`;
      let balanceAfterReset = existing.balanceMinutes;
      if (isResetPeriod && !alreadyResetThisYear.has(resetKey)) {
        const coMins = rule?.carryOverHours != null ? rule.carryOverHours * 60 : null;
        const resetCarryOver = pConfig?.carryOverEnabled === false
          ? 0
          : coMins != null
            ? Math.min(existing.balanceMinutes, coMins)
            : existing.balanceMinutes; // unlimited carry-over = preserve full balance
        if (existing.balanceMinutes > 0) {
          await db.$transaction([
            db.leaveBalance.update({ where: { id: existing.id }, data: { balanceMinutes: 0 } }),
            db.leaveAccrualLedger.create({
              data: {
                employeeId: employee.id, leaveTypeId: leaveType.id,
                action: "BALANCE_RESET",
                deltaMinutes: -existing.balanceMinutes, balanceAfter: 0,
                payPeriodEnd: payPeriod.endDate,
              },
            }),
          ]);
        }
        if (resetCarryOver > 0) {
          const targetLtId = rule?.carryOverToLeaveTypeId ?? null;
          if (targetLtId && targetLtId !== leaveType.id) {
            // Carry over into a different leave type bucket
            const targetBalance = await db.leaveBalance.upsert({
              where: { employeeId_leaveTypeId_accrualYear: { employeeId: employee.id, leaveTypeId: targetLtId, accrualYear } },
              update: {},
              create: { employeeId: employee.id, leaveTypeId: targetLtId, accrualYear, balanceMinutes: 0, usedMinutes: 0 },
            });
            // If carryOverRespectMaxBalance, clamp to the destination's max balance
            let actualCarryOver = resetCarryOver;
            if (pConfig?.carryOverRespectMaxBalance) {
              const destPolicyId =
                (employee.payCategoryId ? catPolicyMap.get(`${employee.payCategoryId}:${targetLtId}`) : undefined) ??
                sitePolicyMap.get(`${employee.siteId}:${targetLtId}`) ??
                defaultPolicyByLeaveType.get(targetLtId);
              const destTiers = destPolicyId ? (ruleMap.get(`${destPolicyId}:${targetLtId}`) ?? []) : [];
              const destRule = destTiers.find(
                (t) => t.minTenureMonths <= tenureMonths && (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
              ) ?? null;
              if (destRule?.maxBalanceHours != null) {
                const destMaxMins = Math.round(destRule.maxBalanceHours * 60);
                actualCarryOver = Math.max(0, Math.min(resetCarryOver, destMaxMins - targetBalance.balanceMinutes));
              }
            }
            if (actualCarryOver > 0) {
              const newTargetBalance = targetBalance.balanceMinutes + actualCarryOver;
              await db.$transaction([
                db.leaveBalance.update({ where: { id: targetBalance.id }, data: { balanceMinutes: newTargetBalance } }),
                db.leaveAccrualLedger.create({
                  data: {
                    employeeId: employee.id, leaveTypeId: targetLtId,
                    action: "CARRY_OVER",
                    deltaMinutes: actualCarryOver, balanceAfter: newTargetBalance,
                    payPeriodEnd: payPeriod.endDate,
                  },
                }),
              ]);
            }
            balanceAfterReset = 0;
          } else {
            await db.$transaction([
              db.leaveBalance.update({ where: { id: existing.id }, data: { balanceMinutes: resetCarryOver } }),
              db.leaveAccrualLedger.create({
                data: {
                  employeeId: employee.id, leaveTypeId: leaveType.id,
                  action: "CARRY_OVER",
                  deltaMinutes: resetCarryOver, balanceAfter: resetCarryOver,
                  payPeriodEnd: payPeriod.endDate,
                },
              }),
            ]);
            balanceAfterReset = resetCarryOver;
          }
        } else {
          balanceAfterReset = 0;
        }
        alreadyResetThisYear.add(resetKey);
      }

      // Compute posting rate in minutes.
      // In PER_POSTING mode the stored value IS the per-posting amount, so there
      // is no meaningful yearly cap — the posting frequency controls cadence.
      let rate: number;
      const annualCapMinutes =
        effectiveAnnualHours > 0 && rateMode === "YEARLY"
          ? effectiveAnnualHours * 60
          : null;

      if (effectiveAnnualHours > 0) {
        rate = computeRate(activeFreq, rateMode, effectiveAnnualHours, ppy) * postingCount;
      } else {
        // Flat LeaveType fallback (backward compat) — always posts per pay period
        rate = leaveType.accrualRateMinutes;
      }

      if (rate <= 0) continue;

      // Enforce annual cap — don't accrue beyond hoursPerYear for the year
      if (annualCapMinutes !== null) {
        const alreadyAccrued = accrualSumMap.get(`${employee.id}:${leaveType.id}`) ?? 0;
        if (alreadyAccrued >= annualCapMinutes) continue;
        rate = Math.min(rate, annualCapMinutes - alreadyAccrued);
      }

      // Use post-reset balance as the starting point for this accrual
      const currentBalance = balanceAfterReset;
      const cap = rule?.maxBalanceHours != null
        ? Math.round(rule.maxBalanceHours * 60)
        : leaveType.maxBalanceMinutes;
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
 * Post accruals for every active employee × active leave type for a single calendar day.
 * Called by the daily cron job. Skips PER_PAY_PERIOD policies (handled by postAccruals on lock).
 *
 * Idempotent: if an ACCRUAL ledger entry already exists with payPeriodEnd = runDate for a given
 * (employeeId, leaveTypeId) pair, that pair is skipped — safe to re-run if the cron fires twice.
 */
export async function runDailyAccruals(runDate?: Date): Promise<{ posted: number }> {
  const today = runDate ?? new Date();
  // Normalize to UTC calendar date so it matches how dates are stored in the DB
  const postingDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  // Single-day window for postingTriggered (ppStart = ppEndIncl = today)
  const ppDay = parseUtcDate(postingDate);

  const accrualYear = getYear(postingDate);
  const yearStart = new Date(`${accrualYear}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${accrualYear + 1}-01-01T00:00:00Z`);

  const [employees, leaveTypes, rules, siteLinks, catPolicyLinks] = await Promise.all([
    db.employee.findMany({
      where: { isActive: true },
      select: {
        id: true, siteId: true, tenantId: true, payCategoryId: true, hireDate: true,
        adjustedHireDate: true, titleChangeDate: true,
        orientationDate: true, userDate2: true,
      },
    }),
    db.leaveType.findMany({ where: { isActive: true } }),
    db.ptoPolicyRule.findMany({
      where: { ptoPolicy: { isActive: true } },
      include: {
        ptoPolicy: {
          select: {
            tenantId:                   true,
            isDefault:                  true,
            rateMode:                   true,
            serviceMonthBasis:          true,
            postingAnchorDate:          true,
            posting1Freq:               true,
            posting1Month:              true,
            posting1Day:                true,
            dualPosting:                true,
            posting2Freq:               true,
            posting2Month:              true,
            posting2Day:                true,
            balanceReset:               true,
            resetMonth:                 true,
            resetDay:                   true,
            carryOverEnabled:           true,
            carryOverRespectMaxBalance: true,
          },
        },
      },
    }),
    db.sitePtoPolicy.findMany({}),
    db.payCategoryPtoPolicy.findMany({
      include: { ptoPolicy: { select: { id: true, rules: { select: { leaveTypeId: true } } } } },
    }),
  ]);

  const employeeIds = employees.map((e) => e.id);

  // Annual cap: sum all ACCRUAL entries this year (pay-period-locked + daily-cron entries combined)
  const accrualSums = await db.leaveAccrualLedger.groupBy({
    by: ["employeeId", "leaveTypeId"],
    where: {
      action: "ACCRUAL",
      payPeriodEnd: { gte: yearStart, lt: yearEnd },
      employeeId: { in: employeeIds },
    },
    _sum: { deltaMinutes: true },
  });
  const accrualSumMap = new Map(
    accrualSums.map((s) => [`${s.employeeId}:${s.leaveTypeId}`, s._sum.deltaMinutes ?? 0])
  );

  // Dedup: find any ACCRUAL entries already posted on today's date — skip those pairs
  const todayPostings = await db.leaveAccrualLedger.findMany({
    where: {
      action: "ACCRUAL",
      payPeriodEnd: postingDate,
      employeeId: { in: employeeIds },
    },
    select: { employeeId: true, leaveTypeId: true },
  });
  const alreadyPostedToday = new Set(
    todayPostings.map((p) => `${p.employeeId}:${p.leaveTypeId}`)
  );

  // Balance-reset dedup: employees whose balance was already reset this year
  const yearResets = await db.leaveAccrualLedger.findMany({
    where: {
      action: "BALANCE_RESET",
      payPeriodEnd: { gte: yearStart, lt: yearEnd },
      employeeId: { in: employeeIds },
    },
    select: { employeeId: true, leaveTypeId: true },
  });
  const alreadyResetThisYear = new Set(
    yearResets.map((r) => `${r.employeeId}:${r.leaveTypeId}`)
  );

  // Build lookup maps
  const ruleMap = new Map<string, typeof rules>();
  const policyConfigMap = new Map<string, (typeof rules)[number]["ptoPolicy"]>();
  for (const r of rules) {
    const k = `${r.ptoPolicyId}:${r.leaveTypeId}`;
    const list = ruleMap.get(k) ?? [];
    list.push(r);
    ruleMap.set(k, list);
    if (!policyConfigMap.has(r.ptoPolicyId)) {
      policyConfigMap.set(r.ptoPolicyId, r.ptoPolicy);
    }
  }
  for (const list of ruleMap.values()) list.sort((a, b) => a.minTenureMonths - b.minTenureMonths);

  const sitePolicyMap = new Map(
    siteLinks.map((s) => [`${s.siteId}:${s.leaveTypeId}`, s.ptoPolicyId])
  );
  // payCategoryId:leaveTypeId → ptoPolicyId (first policy in category that covers this leave type)
  const catPolicyMap = new Map<string, string>();
  for (const link of catPolicyLinks) {
    for (const rule of link.ptoPolicy.rules) {
      const k = `${link.payCategoryId}:${rule.leaveTypeId}`;
      if (!catPolicyMap.has(k)) catPolicyMap.set(k, link.ptoPolicyId);
    }
  }
  // Default policy scoped per tenant + leave type
  const defaultPolicyMap = new Map<string, string>();
  for (const r of rules) {
    if (r.ptoPolicy.isDefault) {
      defaultPolicyMap.set(`${r.ptoPolicy.tenantId}:${r.leaveTypeId}`, r.ptoPolicyId);
    }
  }

  let posted = 0;

  for (const employee of employees) {
    for (const leaveType of leaveTypes) {
      // Enforce tenant isolation — only pair same-tenant employees with leave types
      if (leaveType.tenantId !== employee.tenantId) continue;

      // Dedup: skip if already posted today for this employee/leaveType
      if (alreadyPostedToday.has(`${employee.id}:${leaveType.id}`)) continue;

      const policyId =
        (employee.payCategoryId ? catPolicyMap.get(`${employee.payCategoryId}:${leaveType.id}`) : undefined) ??
        sitePolicyMap.get(`${employee.siteId}:${leaveType.id}`) ??
        defaultPolicyMap.get(`${employee.tenantId}:${leaveType.id}`);

      const tiers = policyId ? (ruleMap.get(`${policyId}:${leaveType.id}`) ?? []) : [];
      const pConfig = policyId ? policyConfigMap.get(policyId) : null;

      // Only process non-PER_PAY_PERIOD policies — PER_PAY_PERIOD is handled by postAccruals
      if (!pConfig || pConfig.posting1Freq === "PER_PAY_PERIOD") continue;

      // Resolve basis date
      const basis: ServiceMonthBasis = pConfig.serviceMonthBasis ?? "HIRE_DATE";
      const basisRaw =
        basis === "ADJUSTED_HIRE_DATE" ? (employee.adjustedHireDate ?? employee.hireDate) :
        basis === "TITLE_CHANGE_DATE"  ? (employee.titleChangeDate  ?? employee.hireDate) :
        basis === "ORIENTATION_DATE"   ? (employee.orientationDate  ?? employee.hireDate) :
        basis === "USER_DATE_2"        ? (employee.userDate2        ?? employee.hireDate) :
        employee.hireDate;
      const empBasisDate = parseUtcDate(basisRaw);
      // Cycle anchor: use the policy's postingAnchorDate when set (all employees share the same
      // cycle phase), otherwise fall back to the individual hire-basis date.
      const cycleAnchor = pConfig.postingAnchorDate ? parseUtcDate(pConfig.postingAnchorDate) : empBasisDate;

      // Don't post before the employee's basis date. differenceInMonths returns 0
      // for any gap < 1 month, so a cycle landing up to 28 days before hire would
      // incorrectly match the minTenureMonths = 0 tier without this guard.
      if (ppDay < empBasisDate) continue;

      const tenureMonths = differenceInMonths(postingDate, basisRaw);
      const rule = tiers.find(
        (t) =>
          t.minTenureMonths <= tenureMonths &&
          (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
      ) ?? null;

      const tenureYears = Math.floor(tenureMonths / 12);
      const effectiveAnnualHours = rule
        ? rule.annualHours + tenureYears * rule.earnedHoursPerYear
        : 0;

      // Check whether today is the balance reset date for this policy
      const isResetDay = !!(
        pConfig.balanceReset &&
        pConfig.resetMonth != null && pConfig.resetDay != null &&
        ppDay.getMonth() + 1 === pConfig.resetMonth &&
        ppDay.getDate() === pConfig.resetDay
      );

      // No flat-fallback in the daily cron — that path belongs to PER_PAY_PERIOD.
      // Still proceed if it's a reset day so the balance gets zeroed even without an accrual.
      if (effectiveAnnualHours <= 0 && !isResetDay) continue;

      // Check whether today triggers a posting under this policy's schedule
      let activeFreq: AccrualPostingFreq | null = null;
      let postingCount = 0;
      if (effectiveAnnualHours > 0) {
        const p1count = postingTriggered(
          pConfig.posting1Freq, pConfig.posting1Month, pConfig.posting1Day,
          ppDay, ppDay, cycleAnchor, empBasisDate
        );
        const p2count =
          pConfig.dualPosting && pConfig.posting2Freq != null
            ? postingTriggered(
                pConfig.posting2Freq, pConfig.posting2Month, pConfig.posting2Day,
                ppDay, ppDay, cycleAnchor, empBasisDate
              )
            : 0;
        if (p1count || p2count) {
          activeFreq = p1count ? pConfig.posting1Freq : pConfig.posting2Freq!;
          postingCount = p1count || p2count;
        }
      }
      const accrualFires = postingCount > 0;

      if (!accrualFires && !isResetDay) continue;

      const rateMode: AccrualRateMode = pConfig.rateMode ?? "YEARLY";

      // Carry-over: if this is the first accrual of the year, seed opening balance.
      // Skipped on reset days — balance resets to 0 so carry-over is irrelevant.
      const balanceKey = { employeeId: employee.id, leaveTypeId: leaveType.id, accrualYear };
      const existingThisYear = await db.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_accrualYear: balanceKey },
        select: { id: true },
      });

      let openingCarryOver = 0;
      if (!existingThisYear && rule && !isResetDay) {
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
        if (prevYear && prevYear.balanceMinutes > 0 && pConfig?.carryOverEnabled !== false) {
          const capMinutes = rule.carryOverHours != null ? rule.carryOverHours * 60 : null;
          openingCarryOver = capMinutes != null
            ? Math.min(prevYear.balanceMinutes, capMinutes)
            : prevYear.balanceMinutes;
        }
      }

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

      // Balance reset: zero the balance, then restore carry-over up to the policy limit.
      // e.g. carry-over = 5 hrs → employee finishes the reset with 5 hrs available.
      // Only fires once per year (alreadyResetThisYear prevents double-reset on re-run).
      const resetKey = `${employee.id}:${leaveType.id}`;
      let balanceAfterReset = existing.balanceMinutes;
      if (isResetDay && !alreadyResetThisYear.has(resetKey)) {
        const coMins = rule?.carryOverHours != null ? rule.carryOverHours * 60 : null;
        const resetCarryOver = pConfig?.carryOverEnabled === false
          ? 0
          : coMins != null
            ? Math.min(existing.balanceMinutes, coMins)
            : existing.balanceMinutes; // unlimited carry-over = preserve full balance
        if (existing.balanceMinutes > 0) {
          await db.$transaction([
            db.leaveBalance.update({ where: { id: existing.id }, data: { balanceMinutes: 0 } }),
            db.leaveAccrualLedger.create({
              data: {
                employeeId: employee.id, leaveTypeId: leaveType.id,
                action: "BALANCE_RESET",
                deltaMinutes: -existing.balanceMinutes, balanceAfter: 0,
                payPeriodEnd: postingDate,
              },
            }),
          ]);
        }
        if (resetCarryOver > 0) {
          const targetLtId = rule?.carryOverToLeaveTypeId ?? null;
          if (targetLtId && targetLtId !== leaveType.id) {
            // Carry over into a different leave type bucket
            const targetBalance = await db.leaveBalance.upsert({
              where: { employeeId_leaveTypeId_accrualYear: { employeeId: employee.id, leaveTypeId: targetLtId, accrualYear } },
              update: {},
              create: { employeeId: employee.id, leaveTypeId: targetLtId, accrualYear, balanceMinutes: 0, usedMinutes: 0 },
            });
            // If carryOverRespectMaxBalance, clamp to the destination's max balance
            let actualCarryOver = resetCarryOver;
            if (pConfig?.carryOverRespectMaxBalance) {
              const destPolicyId =
                (employee.payCategoryId ? catPolicyMap.get(`${employee.payCategoryId}:${targetLtId}`) : undefined) ??
                sitePolicyMap.get(`${employee.siteId}:${targetLtId}`) ??
                defaultPolicyMap.get(`${employee.tenantId}:${targetLtId}`);
              const destTiers = destPolicyId ? (ruleMap.get(`${destPolicyId}:${targetLtId}`) ?? []) : [];
              const destRule = destTiers.find(
                (t) => t.minTenureMonths <= tenureMonths && (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
              ) ?? null;
              if (destRule?.maxBalanceHours != null) {
                const destMaxMins = Math.round(destRule.maxBalanceHours * 60);
                actualCarryOver = Math.max(0, Math.min(resetCarryOver, destMaxMins - targetBalance.balanceMinutes));
              }
            }
            if (actualCarryOver > 0) {
              const newTargetBalance = targetBalance.balanceMinutes + actualCarryOver;
              await db.$transaction([
                db.leaveBalance.update({ where: { id: targetBalance.id }, data: { balanceMinutes: newTargetBalance } }),
                db.leaveAccrualLedger.create({
                  data: {
                    employeeId: employee.id, leaveTypeId: targetLtId,
                    action: "CARRY_OVER",
                    deltaMinutes: actualCarryOver, balanceAfter: newTargetBalance,
                    payPeriodEnd: postingDate,
                  },
                }),
              ]);
            }
            balanceAfterReset = 0;
          } else {
            await db.$transaction([
              db.leaveBalance.update({ where: { id: existing.id }, data: { balanceMinutes: resetCarryOver } }),
              db.leaveAccrualLedger.create({
                data: {
                  employeeId: employee.id, leaveTypeId: leaveType.id,
                  action: "CARRY_OVER",
                  deltaMinutes: resetCarryOver, balanceAfter: resetCarryOver,
                  payPeriodEnd: postingDate,
                },
              }),
            ]);
            balanceAfterReset = resetCarryOver;
          }
        } else {
          balanceAfterReset = 0;
        }
        alreadyResetThisYear.add(resetKey);
      }

      // If no accrual fires today (reset-only day), we're done for this pair
      if (!accrualFires) continue;

      // ppy is unused for non-PER_PAY_PERIOD freqs (computeRate uses hardcoded divisors)
      let rate = computeRate(activeFreq!, rateMode, effectiveAnnualHours, 0) * postingCount;
      if (rate <= 0) continue;

      // Annual cap (YEARLY mode only — PER_POSTING has no cap by design)
      const annualCapMinutes = rateMode === "YEARLY" ? effectiveAnnualHours * 60 : null;
      if (annualCapMinutes !== null) {
        const alreadyAccrued = accrualSumMap.get(`${employee.id}:${leaveType.id}`) ?? 0;
        if (alreadyAccrued >= annualCapMinutes) continue;
        rate = Math.min(rate, annualCapMinutes - alreadyAccrued);
      }

      // Use post-reset balance as the starting point for this accrual
      const currentBalance = balanceAfterReset;
      const cap = rule?.maxBalanceHours != null
        ? Math.round(rule.maxBalanceHours * 60)
        : leaveType.maxBalanceMinutes;
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
            payPeriodEnd: postingDate,
          },
        }),
      ]);

      // Keep the in-memory sum accurate for subsequent iterations in the same run
      const key = `${employee.id}:${leaveType.id}`;
      accrualSumMap.set(key, (accrualSumMap.get(key) ?? 0) + actualDelta);
      posted++;
    }
  }

  return { posted };
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
