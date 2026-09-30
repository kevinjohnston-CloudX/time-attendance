import { redirect, notFound } from "next/navigation";
import { getSubordinateIds } from "@/lib/get-subordinate-ids";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployeeById } from "@/actions/admin.actions";
import { LeaveBalancesPanel } from "@/components/admin/leave-balances-panel";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { format, differenceInMonths, differenceInDays, addMonths } from "date-fns";

/**
 * One employee's accruals, on the design's doc template: the policies that
 * earn for them, the balances those policies produced, and the ledger behind
 * whichever balance is being questioned.
 *
 * <p>Everything below the header is computed here and handed down. The
 * expected-accrual and forecast arithmetic in particular has to run on the
 * server — it walks a policy's tiers posting by posting, and it is the number
 * somebody disputes when a balance looks wrong, so it is worked out once from
 * the policy rather than re-derived by a component.
 *
 * <p>The page used to be capped at max-w-2xl. The ledger is a six-column table
 * of hours and it was being read through a 672px window; the doc template's
 * own default is full width, which is what it gets.
 */
export default async function EmployeeAccrualsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canViewAny  = await userHasPermission(session.user, "ACCRUAL_VIEW_ANY");
  const canViewTeam = canViewAny  || await userHasPermission(session.user, "ACCRUAL_VIEW_TEAM");
  const canViewOwn  = canViewTeam || await userHasPermission(session.user, "ACCRUAL_VIEW_OWN");

  if (!canViewOwn) redirect("/dashboard");

  // Scope enforcement
  if (!canViewTeam && session.user.employeeId !== id) redirect("/accruals");
  if (canViewTeam && !canViewAny && session.user.employeeId !== id) {
    // Verify this employee is in the supervisor's full subordinate tree
    if (!session.user.employeeId) redirect("/accruals");
    const subordinateIds = await getSubordinateIds(session.user.employeeId, session.user.tenantId ?? null);
    if (!subordinateIds.includes(id)) redirect("/accruals");
  }

  const canManageEmployee = await userHasPermission(session.user, "EMPLOYEE_MANAGE");
  const canManageRules = await userHasPermission(session.user, "RULES_MANAGE");

  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`);

  const [empResult, leaveTypes, leaveBalanceRows, accrualSums, timecardDeductionEntries, approvedRequests, postedRequests, pastYearRows] =
    await Promise.all([
      getEmployeeById({ employeeId: id }),
      db.leaveType.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, category: true, accrualTracked: true },
      }),
      db.leaveBalance.findMany({ where: { employeeId: id, accrualYear: year } }),
      db.leaveAccrualLedger.groupBy({
        by: ["leaveTypeId"],
        where: { employeeId: id, action: { in: ["ACCRUAL", "EARNED_ADJUSTMENT"] }, payPeriodEnd: { gte: yearStart, lt: yearEnd } },
        _sum: { deltaMinutes: true },
        _count: { id: true },
      }),
      db.leaveAccrualLedger.findMany({
        where: { employeeId: id, action: "TIMECARD_DEDUCTION" },
        select: { leaveRequestId: true },
      }),
      db.leaveRequest.findMany({
        where: { employeeId: id, status: { in: ["APPROVED", "PENDING"] } },
        select: { leaveTypeId: true, durationMinutes: true, status: true },
      }),
      db.leaveRequest.findMany({
        where: { employeeId: id, status: "POSTED" },
        select: { leaveTypeId: true, durationMinutes: true },
      }),
      db.leaveBalance.findMany({
        where: { employeeId: id, accrualYear: { lt: year } },
        select: { accrualYear: true },
        distinct: ["accrualYear"],
        orderBy: { accrualYear: "desc" },
      }),
    ]);

  if (!empResult.success) notFound();

  const employee = empResult.data;

  const timecardRequestIds = new Set(
    timecardDeductionEntries.map((e) => e.leaveRequestId).filter(Boolean)
  );
  const adjustmentSums = await db.leaveAccrualLedger.groupBy({
    by: ["leaveTypeId"],
    where: {
      employeeId: id,
      action: "ADJUSTMENT",
      createdAt: { gte: yearStart, lt: yearEnd },
      leaveRequestId: timecardRequestIds.size > 0
        ? { notIn: [...timecardRequestIds] as string[] }
        : undefined,
    },
    _sum: { deltaMinutes: true },
  });

  const payCategoryWithPolicies = employee.payCategoryId
    ? await db.payCategory.findUnique({
        where: { id: employee.payCategoryId },
        include: {
          ptoPolicies: {
            include: {
              ptoPolicy: {
                select: {
                  id: true,
                  name: true,
                  rateMode: true,
                  posting1Freq: true,
                  serviceMonthBasis: true,
                  postingAnchorDate: true,
                  forecastEnabled: true,
                  forecastMode: true,
                  forecastMonths: true,
                  forecastApplyToAvailable: true,
                  rules: {
                    select: {
                      leaveTypeId: true,
                      minTenureMonths: true,
                      maxTenureMonths: true,
                      annualHours: true,
                      earnedHoursPerYear: true,
                    },
                    orderBy: { minTenureMonths: "asc" },
                  },
                },
              },
            },
          },
        },
      })
    : null;

  const today = new Date();

  type PolicyTier = {
    minTenureMonths: number;
    maxTenureMonths: number | null;
    annualHours: number;
    earnedHoursPerYear: number;
  };

  function computeExpectedMinutes(
    tiers: PolicyTier[],
    rateMode: string,
    postingFreq: string,
    basisDate: Date,
    cycleAnchor: Date,
    accruedMinutes: number,
    actualPostingCount: number,
  ): number | null {
    if (postingFreq === "PER_PAY_PERIOD" || tiers.length === 0) return null;

    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInYear = isLeap ? 366 : 365;
    const ms = 86400000;

    function countPostingsInRange(from: Date, to: Date): number {
      if (from > to) return 0;

      function countAnchored(period: number): number {
        const aDay = Math.floor(cycleAnchor.getTime() / ms);
        const fDay = Math.floor(from.getTime() / ms);
        const tDay = Math.floor(to.getTime() / ms);
        const firstIdx = Math.ceil((fDay - aDay) / period);
        const firstDay = aDay + firstIdx * period;
        if (firstDay > tDay) return 0;
        return Math.floor((tDay - firstDay) / period) + 1;
      }

      function countCalendar(monthDays: [number, number][]): number {
        let count = 0;
        for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
          for (const [m, d] of monthDays) {
            const p = new Date(Date.UTC(y, m, d));
            if (p >= from && p <= to) count++;
          }
        }
        return count;
      }

      switch (postingFreq) {
        case "DAILY":          return Math.floor((to.getTime() - from.getTime()) / ms) + 1;
        case "WEEKLY":         return countAnchored(7);
        case "BI_WEEKLY":      return countAnchored(14);
        case "SEMI_MONTHLY": {
          const md: [number, number][] = [];
          for (let m = 0; m < 12; m++) md.push([m, 1], [m, 15]);
          return countCalendar(md);
        }
        case "MONTHLY":        return countCalendar(Array.from({ length: 12 }, (_, m) => [m, 1] as [number, number]));
        case "EVERY_2_MONTHS": return countCalendar([[0,1],[2,1],[4,1],[6,1],[8,1],[10,1]]);
        case "QUARTERLY":      return countCalendar([[0,1],[3,1],[6,1],[9,1]]);
        case "EVERY_4_MONTHS": return countCalendar([[0,1],[4,1],[8,1]]);
        case "SEMI_ANNUALLY":  return countCalendar([[0,1],[6,1]]);
        case "ANNUALLY":       return countCalendar([[0,1]]);
        case "ANNUALLY_HIRE": {
          const anniv = new Date(Date.UTC(today.getUTCFullYear(), basisDate.getUTCMonth(), basisDate.getUTCDate()));
          return (anniv >= from && anniv <= to) ? 1 : 0;
        }
        default: return 0;
      }
    }

    function utcDay(d: Date) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    const yearEffectiveStart = utcDay(basisDate > yearStart ? basisDate : yearStart);
    if (yearEffectiveStart >= utcDay(today)) return 0;

    const expectedCeiling = new Date(utcDay(today).getTime() - ms);

    let totalMinutes = 0;
    let countExpected = 0;

    for (const tier of tiers) {
      const tierFrom = utcDay(addMonths(basisDate, tier.minTenureMonths));
      const tierTo = tier.maxTenureMonths != null
        ? new Date(utcDay(addMonths(basisDate, tier.maxTenureMonths)).getTime() - ms)
        : null;

      const segFrom = tierFrom > yearEffectiveStart ? tierFrom : yearEffectiveStart;
      const segTo   = tierTo ? (tierTo < expectedCeiling ? tierTo : expectedCeiling) : expectedCeiling;

      if (segFrom > segTo) continue;

      const tenureMonthsAtSeg = differenceInMonths(segFrom, basisDate);
      const tenureYearsAtSeg  = Math.floor(tenureMonthsAtSeg / 12);
      const effectiveHours    = tier.annualHours + tenureYearsAtSeg * tier.earnedHoursPerYear;
      if (effectiveHours <= 0) continue;

      const postingsInSeg = countPostingsInRange(segFrom, segTo);
      countExpected += postingsInSeg;

      if (rateMode === "YEARLY") {
        const daysInSeg = differenceInDays(segTo, segFrom) + 1;
        totalMinutes += Math.round(effectiveHours * 60 / daysInYear * daysInSeg);
      } else {
        const ratePerPosting = Math.round(effectiveHours * 60);
        totalMinutes += ratePerPosting * postingsInSeg;
      }
    }

    if (actualPostingCount >= countExpected) return accruedMinutes;

    const missedPostings = countExpected - actualPostingCount;
    const avgRatePerPosting = countExpected > 0 ? totalMinutes / countExpected : 0;
    return Math.round(accruedMinutes + missedPostings * avgRatePerPosting);
  }

  function computeForecastedMinutes(
    tiers: PolicyTier[],
    rateMode: string,
    postingFreq: string,
    basisDate: Date,
    cycleAnchor: Date,
    fcMode: string,
    fcMonths: number | null,
    alreadyAccruedThisYear: number,
    actualPostingCount: number,
  ): number | null {
    if (tiers.length === 0) return null;

    const ms = 86400000;
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInYear = isLeap ? 366 : 365;

    function utcDay(d: Date) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    const todayUtc = utcDay(today);
    const yearEndDate = new Date(Date.UTC(year, 11, 31));

    let forecastEndDate: Date;
    if (fcMode === "MONTHS" && fcMonths != null) {
      const candidate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + fcMonths, today.getUTCDate()));
      forecastEndDate = candidate < yearEndDate ? candidate : yearEndDate;
    } else {
      forecastEndDate = yearEndDate;
    }

    if (todayUtc >= forecastEndDate) return 0;
    const forecastStart = new Date(todayUtc.getTime() + ms);

    const tenureMonths = differenceInMonths(today, basisDate);
    const tenureYears = Math.floor(tenureMonths / 12);
    const currentTier = tiers.find(
      (t) => t.minTenureMonths <= tenureMonths && (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths)
    );
    if (!currentTier) return 0;

    const effectiveHours = currentTier.annualHours + tenureYears * currentTier.earnedHoursPerYear;
    if (effectiveHours <= 0) return 0;

    const annualCapMinutes = rateMode === "YEARLY" ? Math.round(effectiveHours * 60) : null;
    const remainingBudget = annualCapMinutes !== null
      ? Math.max(0, annualCapMinutes - alreadyAccruedThisYear)
      : null;
    if (remainingBudget !== null && remainingBudget <= 0) return 0;

    function countPostings(from: Date, to: Date): number {
      if (from > to) return 0;
      function countAnchored(period: number): number {
        const aDay = Math.floor(cycleAnchor.getTime() / ms);
        const fDay = Math.floor(from.getTime() / ms);
        const tDay = Math.floor(to.getTime() / ms);
        const firstIdx = Math.ceil((fDay - aDay) / period);
        const firstDay = aDay + firstIdx * period;
        if (firstDay > tDay) return 0;
        return Math.floor((tDay - firstDay) / period) + 1;
      }
      function countCalendar(monthDays: [number, number][]): number {
        let count = 0;
        for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
          for (const [m, d] of monthDays) {
            const p = new Date(Date.UTC(y, m, d));
            if (p >= from && p <= to) count++;
          }
        }
        return count;
      }
      switch (postingFreq) {
        case "DAILY":          return Math.floor((to.getTime() - from.getTime()) / ms) + 1;
        case "WEEKLY":         return countAnchored(7);
        case "BI_WEEKLY":      return countAnchored(14);
        case "SEMI_MONTHLY": { const md: [number, number][] = []; for (let m = 0; m < 12; m++) md.push([m,1],[m,15]); return countCalendar(md); }
        case "MONTHLY":        return countCalendar(Array.from({length:12},(_,m)=>[m,1] as [number,number]));
        case "EVERY_2_MONTHS": return countCalendar([[0,1],[2,1],[4,1],[6,1],[8,1],[10,1]]);
        case "QUARTERLY":      return countCalendar([[0,1],[3,1],[6,1],[9,1]]);
        case "EVERY_4_MONTHS": return countCalendar([[0,1],[4,1],[8,1]]);
        case "SEMI_ANNUALLY":  return countCalendar([[0,1],[6,1]]);
        case "ANNUALLY":       return countCalendar([[0,1]]);
        case "ANNUALLY_HIRE": {
          const anniv = new Date(Date.UTC(today.getUTCFullYear(), basisDate.getUTCMonth(), basisDate.getUTCDate()));
          return (anniv >= from && anniv <= to) ? 1 : 0;
        }
        default: return 0;
      }
    }

    let forecastMinutes: number;

    if (postingFreq === "PER_PAY_PERIOD") {
      if (rateMode === "PER_POSTING") {
        // Interpolate remaining pay-period postings from actual count so far this year.
        // elapsed = days from Jan 1 to today; remaining = days from today to forecastEndDate.
        const yearStartUtc = new Date(Date.UTC(year, 0, 1));
        const elapsedDays = Math.max(1, Math.floor((todayUtc.getTime() - yearStartUtc.getTime()) / ms));
        const remainingDays = Math.max(0, Math.floor((forecastEndDate.getTime() - todayUtc.getTime()) / ms));
        const remainingPostings = Math.round(actualPostingCount * (remainingDays / elapsedDays));
        forecastMinutes = remainingPostings * Math.round(effectiveHours * 60);
      } else if (rateMode === "YEARLY") {
        const daysRemaining = Math.max(0, Math.floor((forecastEndDate.getTime() - todayUtc.getTime()) / ms));
        forecastMinutes = Math.round(effectiveHours * 60 / daysInYear * daysRemaining);
      } else {
        return null;
      }
    } else {
      const postings = countPostings(forecastStart, forecastEndDate);
      const ratePerPosting = rateMode === "PER_POSTING"
        ? Math.round(effectiveHours * 60)
        : (() => {
            const annualMins = effectiveHours * 60;
            switch (postingFreq) {
              case "DAILY":          return Math.round(annualMins / 365);
              case "WEEKLY":         return Math.round(annualMins / 52);
              case "BI_WEEKLY":      return Math.round(annualMins / 26);
              case "SEMI_MONTHLY":   return Math.round(annualMins / 24);
              case "MONTHLY":        return Math.round(annualMins / 12);
              case "EVERY_2_MONTHS": return Math.round(annualMins / 6);
              case "QUARTERLY":      return Math.round(annualMins / 4);
              case "EVERY_4_MONTHS": return Math.round(annualMins / 3);
              case "SEMI_ANNUALLY":  return Math.round(annualMins / 2);
              default:               return Math.round(annualMins);
            }
          })();
      forecastMinutes = postings * ratePerPosting;
    }

    return remainingBudget !== null ? Math.min(forecastMinutes, remainingBudget) : forecastMinutes;
  }

  type PolicyRate = {
    tiers: PolicyTier[];
    basisDate: Date;
    cycleAnchor: Date;
    annualHours: number;
    policyName: string;
    rateMode: string;
    postingFreq: string;
    forecastEnabled: boolean;
    forecastMode: string | null;
    forecastMonths: number | null;
    forecastApplyToAvailable: boolean;
  };

  const policyRateByLeaveType = new Map<string, PolicyRate>();
  const policySources = payCategoryWithPolicies?.ptoPolicies.map((l) => l.ptoPolicy) ?? [];

  for (const policy of policySources) {
    const basisRaw =
      policy.serviceMonthBasis === "ADJUSTED_HIRE_DATE" ? ((employee as { adjustedHireDate?: Date | null }).adjustedHireDate ?? employee.hireDate) :
      policy.serviceMonthBasis === "TITLE_CHANGE_DATE"  ? ((employee as { titleChangeDate?: Date | null }).titleChangeDate ?? employee.hireDate) :
      policy.serviceMonthBasis === "ORIENTATION_DATE"   ? ((employee as { orientationDate?: Date | null }).orientationDate ?? employee.hireDate) :
      policy.serviceMonthBasis === "USER_DATE_2"        ? ((employee as { userDate2?: Date | null }).userDate2 ?? employee.hireDate) :
      employee.hireDate;
    const basisDate = basisRaw ?? employee.hireDate;
    const cycleAnchor = policy.postingAnchorDate ?? basisDate;

    for (const lt of leaveTypes) {
      if (policyRateByLeaveType.has(lt.id)) continue;
      const tierRules = policy.rules.filter((r) => r.leaveTypeId === lt.id);
      if (tierRules.length === 0) continue;

      const basisTenureMonths = differenceInMonths(today, basisDate);
      const basisTenureYears  = Math.floor(basisTenureMonths / 12);
      const currentTier = tierRules.find(
        (t) => t.minTenureMonths <= basisTenureMonths && (t.maxTenureMonths === null || basisTenureMonths < t.maxTenureMonths)
      );

      policyRateByLeaveType.set(lt.id, {
        tiers: tierRules,
        basisDate,
        cycleAnchor,
        annualHours: currentTier ? currentTier.annualHours + basisTenureYears * currentTier.earnedHoursPerYear : 0,
        policyName: policy.name,
        rateMode: policy.rateMode,
        postingFreq: policy.posting1Freq,
        forecastEnabled: policy.forecastEnabled,
        forecastMode: policy.forecastMode,
        forecastMonths: policy.forecastMonths,
        forecastApplyToAvailable: policy.forecastApplyToAvailable,
      });
    }
  }

  const accrualSumMap   = new Map(accrualSums.map((s) => [s.leaveTypeId, s._sum.deltaMinutes ?? 0]));
  const accrualCountMap = new Map(accrualSums.map((s) => [s.leaveTypeId, s._count.id ?? 0]));
  const adjustmentSumMap = new Map(adjustmentSums.map((s) => [s.leaveTypeId, s._sum.deltaMinutes ?? 0]));

  const approvedMinutesMap = new Map<string, number>();
  const pendingMinutesMap  = new Map<string, number>();
  for (const r of approvedRequests) {
    if (r.status === "APPROVED") {
      approvedMinutesMap.set(r.leaveTypeId, (approvedMinutesMap.get(r.leaveTypeId) ?? 0) + r.durationMinutes);
    } else {
      pendingMinutesMap.set(r.leaveTypeId, (pendingMinutesMap.get(r.leaveTypeId) ?? 0) + r.durationMinutes);
    }
  }

  const postedMinutesMap = new Map<string, number>();
  for (const r of postedRequests) {
    postedMinutesMap.set(r.leaveTypeId, (postedMinutesMap.get(r.leaveTypeId) ?? 0) + r.durationMinutes);
  }

  const balances = leaveTypes.map((lt) => {
    const bal = leaveBalanceRows.find((b) => b.leaveTypeId === lt.id);
    const policyRate = policyRateByLeaveType.get(lt.id) ?? null;
    const alreadyAccruedThisYear = accrualSumMap.get(lt.id) ?? 0;
    return {
      leaveTypeId: lt.id,
      leaveTypeName: lt.name,
      category: lt.category as string,
      balanceMinutes: bal?.balanceMinutes ?? 0,
      usedMinutes: bal?.usedMinutes ?? 0,
      accruedMinutes: alreadyAccruedThisYear,
      approvedMinutes: approvedMinutesMap.get(lt.id) ?? 0,
      pendingMinutes: pendingMinutesMap.get(lt.id) ?? 0,
      postedMinutes: postedMinutesMap.get(lt.id) ?? 0,
      year,
      policyAnnualHours: policyRate?.annualHours ?? null,
      policyName: policyRate?.policyName ?? null,
      policyRateMode: policyRate?.rateMode ?? null,
      expectedAccrualMinutes: policyRate
        ? computeExpectedMinutes(policyRate.tiers, policyRate.rateMode, policyRate.postingFreq, policyRate.basisDate, policyRate.cycleAnchor, alreadyAccruedThisYear, accrualCountMap.get(lt.id) ?? 0)
        : null,
      forecastedMinutes: policyRate?.forecastEnabled
        ? computeForecastedMinutes(
            policyRate.tiers,
            policyRate.rateMode,
            policyRate.postingFreq,
            policyRate.basisDate,
            policyRate.cycleAnchor,
            policyRate.forecastMode ?? "END_OF_YEAR",
            policyRate.forecastMonths,
            alreadyAccruedThisYear,
            accrualCountMap.get(lt.id) ?? 0,
          )
        : null,
      forecastApplyToAvailable: policyRate?.forecastApplyToAvailable ?? false,
      netAdjustmentMinutes: adjustmentSumMap.has(lt.id) ? (adjustmentSumMap.get(lt.id) ?? 0) : null,
      accrualTracked: lt.accrualTracked,
    };
  });

  const policyMap = new Map<string, string[]>();
  const policyIdMap = new Map<string, string>();
  for (const l of policySources) policyIdMap.set(l.name, l.id);
  for (const b of balances) {
    if (!b.policyName) continue;
    const types = policyMap.get(b.policyName) ?? [];
    types.push(b.leaveTypeName);
    policyMap.set(b.policyName, types);
  }

  const pastYears = pastYearRows.map((r) => r.accrualYear);

  // Suppress unused variable warning — pastYears available for future year-selector feature
  void pastYears;

  /** The tile body, shared so the linked and unlinked policies read identically. */
  const policyTiles = Array.from(policyMap.entries()).map(([name, types]) => {
    const policyId = policyIdMap.get(name);
    const body = (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          style={{
            font: "var(--type-body1)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-primary)",
          }}
        >
          {name}
        </span>
        <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          {types.join(", ")}
        </span>
      </span>
    );
    const frame = "flex items-start gap-2.5 rounded-lg p-3";
    const framing = {
      border: "1px solid var(--stroke-secondary)",
      background: "var(--surface-card)",
    };
    // Only somebody who can edit the policy (RULES_MANAGE) gets a link to it. For everyone
    // else the tile is still the answer to "why is this leave type earning
    // nothing" — it just does not pretend to be a way in.
    return canManageRules && policyId ? (
      <Link
        key={name}
        href={`/admin/rules-setup/leave-policies/${policyId}`}
        className={`ta-hub-card ${frame}`}
        style={framing}
      >
        {body}
      </Link>
    ) : (
      <div key={name} className={frame} style={framing}>
        {body}
      </div>
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader pinned
        title={employee.user.name}
        subtitle={`${employee.wmsId ?? employee.employeeCode} · Hired ${format(employee.hireDate, "MMM d, yyyy")} · ${year} accrual year`}
        actions={
          <>
            {/* Somebody with own-scope only is redirected off the list page
                straight back to here, so the back link would be a loop. */}
            {canViewTeam && (
              <LinkButton href="/accruals" hierarchy="tertiary">
                ← Accruals
              </LinkButton>
            )}
            {canManageEmployee && (
              <LinkButton href={`/admin/employees/${id}`} hierarchy="secondary">
                Edit Employee
              </LinkButton>
            )}
          </>
        }
      />

      <Card
        title="PTO Policies"
        subtitle={
          policyMap.size > 0
            ? "What earns each leave type, and at whose rate"
            : "Nothing is currently earning for this employee"
        }
      >
        {policyMap.size > 0 ? (
          <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
            {policyTiles}
          </div>
        ) : (
          <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
            No time off policies apply to this employee. Assign policies to their pay category to start accruing.
          </p>
        )}
      </Card>

      <LeaveBalancesPanel
        employeeId={employee.id}
        balances={balances}
        canManage={canManageEmployee}
      />
    </div>
  );
}
