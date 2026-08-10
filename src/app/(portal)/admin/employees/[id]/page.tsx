import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getEmployeeById, getAdminRefData, getEmployeeAuditLogs, getEmployeeLeaveLog } from "@/actions/admin.actions";
import { EditEmployeeForm } from "@/components/admin/edit-employee-form";
import { db } from "@/lib/db";
import { format, differenceInMonths, differenceInDays, addMonths } from "date-fns";

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "EMPLOYEE_MANAGE")) redirect("/admin");

  const year = new Date().getFullYear();

  const yearStart = new Date(`${year}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${year + 1}-01-01T00:00:00Z`);

  const [empResult, refResult, leaveTypes, leaveBalanceRows, accrualSums, approvedRequests, logsResult, leaveLogResult] = await Promise.all([
    getEmployeeById({ employeeId: id }),
    getAdminRefData(),
    db.leaveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId: id, accrualYear: year } }),
    db.leaveAccrualLedger.groupBy({
      by: ["leaveTypeId"],
      where: { employeeId: id, action: "ACCRUAL", payPeriodEnd: { gte: yearStart, lt: yearEnd } },
      _sum: { deltaMinutes: true },
    }),
    db.leaveRequest.findMany({
      where: { employeeId: id, status: { in: ["APPROVED", "PENDING"] } },
      select: { leaveTypeId: true, durationMinutes: true, status: true },
    }),
    getEmployeeAuditLogs({ employeeId: id }),
    getEmployeeLeaveLog({ employeeId: id }),
  ]);

  if (!empResult.success) notFound();
  if (!refResult.success) redirect("/admin/employees");

  const logs = logsResult.success ? logsResult.data : [];
  const leaveLog = leaveLogResult.success ? leaveLogResult.data : [];

  const employee = empResult.data;
  const { sites, departments, ruleSets, employees, customRoles, shifts, holidayRules, payCategories } = refResult.data;

  // Load any employee-level PTO policy override (mirrors engine priority: override > pay category)
  const empOverridePolicy = await db.employeePtoPolicyOverride.findFirst({
    where: { employeeId: id },
    include: {
      ptoPolicy: {
        select: {
          id: true,
          name: true,
          rateMode: true,
          posting1Freq: true,
          serviceMonthBasis: true,
          postingAnchorDate: true,
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
  });

  // Load the employee's pay category with all linked PTO policies and their rules
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

  type PolicyTier = { minTenureMonths: number; maxTenureMonths: number | null; annualHours: number; earnedHoursPerYear: number };

  /**
   * Compute expected accrual minutes for a leave type, accounting for mid-year tier changes.
   * basisDate is the employee's tenure anchor (hire date or adjusted hire date per policy).
   * cycleAnchor is the policy's postingAnchorDate when set, otherwise basisDate.
   * Cycle-based frequencies (BI_WEEKLY, WEEKLY) use cycleAnchor to match the engine.
   */
  function computeExpectedMinutes(
    tiers: PolicyTier[],
    rateMode: string,
    postingFreq: string,
    basisDate: Date,
    cycleAnchor: Date,
  ): number | null {
    if (postingFreq === "PER_PAY_PERIOD" || tiers.length === 0) return null;

    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInYear = isLeap ? 366 : 365;
    const ms = 86400000;

    // Count postings in [from, to] (both UTC-day inclusive) for this policy's frequency.
    // Cycle-based freqs (WEEKLY, BI_WEEKLY) anchor to basisDate, matching the engine.
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

    // Normalize a date to UTC midnight for consistent day-boundary comparisons
    function utcDay(d: Date) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    // Year's effective start: later of Jan 1 and the employee's basis date
    const yearEffectiveStart = utcDay(basisDate > yearStart ? basisDate : yearStart);
    if (yearEffectiveStart >= utcDay(today)) return 0;

    let totalMinutes = 0;

    for (const tier of tiers) {
      // Calendar date when this tier becomes active for this employee
      const tierFrom = utcDay(addMonths(basisDate, tier.minTenureMonths));
      // Calendar date when the next tier takes over (exclusive → subtract 1 day for inclusive end)
      const tierTo = tier.maxTenureMonths != null
        ? new Date(utcDay(addMonths(basisDate, tier.maxTenureMonths)).getTime() - ms)
        : null;

      // Intersect tier's active range with [yearEffectiveStart, today)
      const segFrom = tierFrom > yearEffectiveStart ? tierFrom : yearEffectiveStart;
      const segTo   = tierTo ? (tierTo < today ? tierTo : utcDay(today)) : utcDay(today);

      if (segFrom > segTo) continue;

      const tenureMonthsAtSeg = differenceInMonths(segFrom, basisDate);
      const tenureYearsAtSeg  = Math.floor(tenureMonthsAtSeg / 12);
      const effectiveHours    = tier.annualHours + tenureYearsAtSeg * tier.earnedHoursPerYear;
      if (effectiveHours <= 0) continue;

      if (rateMode === "YEARLY") {
        const daysInSeg = differenceInDays(segTo, segFrom) + 1;
        totalMinutes += Math.round(effectiveHours * 60 / daysInYear * daysInSeg);
      } else {
        // PER_POSTING: round per-posting rate then multiply, matching the engine's behavior
        const ratePerPosting = Math.round(effectiveHours * 60);
        const postings = countPostingsInRange(segFrom, segTo);
        totalMinutes += ratePerPosting * postings;
      }
    }

    return totalMinutes;
  }

  const tenureMonths = differenceInMonths(today, employee.hireDate);
  const tenureYears  = Math.floor(tenureMonths / 12);

  type PolicyRate = {
    tiers: PolicyTier[];
    basisDate: Date;
    cycleAnchor: Date;
    annualHours: number;  // current tier rate — for display only
    policyName: string;
    rateMode: string;
    postingFreq: string;
  };
  const policyRateByLeaveType = new Map<string, PolicyRate>();

  // Build policy sources: override first (mirrors engine priority), then pay category
  const policySources = [
    ...(empOverridePolicy ? [empOverridePolicy.ptoPolicy] : []),
    ...(payCategoryWithPolicies?.ptoPolicies.map((l) => l.ptoPolicy) ?? []),
  ];

  for (const policy of policySources) {
    // Resolve basis date per policy's serviceMonthBasis (mirrors the engine)
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
      });
    }
  }

  const accrualSumMap = new Map(
    accrualSums.map((s) => [s.leaveTypeId, s._sum.deltaMinutes ?? 0])
  );

  const approvedMinutesMap = new Map<string, number>();
  const pendingMinutesMap = new Map<string, number>();
  for (const r of approvedRequests) {
    if (r.status === "APPROVED") {
      approvedMinutesMap.set(r.leaveTypeId, (approvedMinutesMap.get(r.leaveTypeId) ?? 0) + r.durationMinutes);
    } else {
      pendingMinutesMap.set(r.leaveTypeId, (pendingMinutesMap.get(r.leaveTypeId) ?? 0) + r.durationMinutes);
    }
  }

  const balances = leaveTypes.map((lt) => {
    const bal = leaveBalanceRows.find((b) => b.leaveTypeId === lt.id);
    const policyRate = policyRateByLeaveType.get(lt.id) ?? null;
    return {
      leaveTypeId: lt.id,
      leaveTypeName: lt.name,
      category: lt.category as string,
      balanceMinutes: bal?.balanceMinutes ?? 0,
      usedMinutes: bal?.usedMinutes ?? 0,
      accruedMinutes: accrualSumMap.get(lt.id) ?? 0,
      approvedMinutes: approvedMinutesMap.get(lt.id) ?? 0,
      pendingMinutes: pendingMinutesMap.get(lt.id) ?? 0,
      year,
      policyAnnualHours: policyRate?.annualHours ?? null,
      policyName: policyRate?.policyName ?? null,
      policyRateMode: policyRate?.rateMode ?? null,
      expectedAccrualMinutes: policyRate
        ? computeExpectedMinutes(policyRate.tiers, policyRate.rateMode, policyRate.postingFreq, policyRate.basisDate, policyRate.cycleAnchor)
        : null,
    };
  });

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/employees"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
      >
        ← Employees
      </Link>

      <div className="mt-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            {employee.user.name}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            @{employee.user.username} · Code: {employee.employeeCode} · Hired{" "}
            {format(employee.hireDate, "MMM d, yyyy")}
          </p>
        </div>
      </div>

      <EditEmployeeForm
        employee={employee}
        sites={sites}
        departments={departments}
        ruleSets={ruleSets}
        employees={employees}
        customRoles={customRoles}
        shifts={shifts}
        holidayRules={holidayRules}
        payCategories={payCategories ?? []}
        balances={balances}
        year={year}
        logs={logs}
        leaveLog={leaveLog}
      />

    </div>
  );
}
