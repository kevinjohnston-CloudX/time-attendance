import { config } from "dotenv";
config({ path: ".env.local" });
import { differenceInMonths } from "date-fns";
import { db } from "@/lib/db";

// Names from spreadsheet (LAST, FIRST format) — search by last name fragment
const EMPLOYEE_NAMES = [
  "Marte", "Gonzalez Torres", "Williams, Sandra", "Mckinney",
  "Sanders, Tyrone", "Salazar, Heliana", "Khandale", "Krajewski",
  "Alejandre Cruz", "Suitter",
];
const YEAR = 2026;

async function main() {
  const today = new Date();
  const yearStart = new Date(`${YEAR}-01-01T00:00:00Z`);
  const yearEnd   = new Date(`${YEAR + 1}-01-01T00:00:00Z`);
  const yearEndDate = new Date(Date.UTC(YEAR, 11, 31));
  const ms = 86400000;
  const isLeap = (YEAR % 4 === 0 && YEAR % 100 !== 0) || YEAR % 400 === 0;
  const daysInYear = isLeap ? 366 : 365;
  const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  const employees = await db.employee.findMany({
    where: {
      OR: EMPLOYEE_NAMES.map(n => ({
        user: { name: { contains: n, mode: "insensitive" as const } }
      }))
    },
    select: {
      id: true, employeeCode: true, hireDate: true, payCategoryId: true,
      adjustedHireDate: true, titleChangeDate: true, orientationDate: true, userDate2: true,
      user: { select: { name: true } },
    },
  });

  const empIds = employees.map(e => e.id);

  const [balances, accrualSums, approvedLeave, catLinks, leaveTypes] = await Promise.all([
    db.leaveBalance.findMany({ where: { employeeId: { in: empIds }, accrualYear: YEAR } }),
    db.leaveAccrualLedger.groupBy({
      by: ["employeeId", "leaveTypeId"],
      where: { action: "ACCRUAL", employeeId: { in: empIds }, payPeriodEnd: { gte: yearStart, lt: yearEnd } },
      _sum: { deltaMinutes: true },
    }),
    db.leaveRequest.findMany({
      where: { employeeId: { in: empIds }, status: { in: ["APPROVED", "PENDING"] } },
      select: { employeeId: true, leaveTypeId: true, durationMinutes: true, status: true },
    }),
    db.payCategoryPtoPolicy.findMany({
      where: { payCategory: { employees: { some: { id: { in: empIds } } } } },
      include: {
        ptoPolicy: {
          select: {
            id: true, name: true, rateMode: true, posting1Freq: true,
            serviceMonthBasis: true, postingAnchorDate: true,
            forecastEnabled: true, forecastMode: true, forecastMonths: true,
            rules: { select: { leaveTypeId: true, minTenureMonths: true, maxTenureMonths: true, annualHours: true, earnedHoursPerYear: true }, orderBy: { minTenureMonths: "asc" } },
          },
        },
      },
    }),
    db.leaveType.findMany({ where: { isActive: true } }),
  ]);

  const catPolicyMap = new Map<string, typeof catLinks[0]["ptoPolicy"][]>();
  for (const link of catLinks) {
    const list = catPolicyMap.get(link.payCategoryId) ?? [];
    list.push(link.ptoPolicy);
    catPolicyMap.set(link.payCategoryId, list);
  }

  // Find the policy that has rules for a specific leave type
  function getPolicyForLeaveType(empId: string, payCategoryId: string | null, leaveTypeId: string) {
    if (payCategoryId) {
      for (const p of catPolicyMap.get(payCategoryId) ?? []) {
        if (p.rules.some(r => r.leaveTypeId === leaveTypeId)) return p;
      }
    }
    return null;
  }

  const balanceMap = new Map(balances.map(b => [`${b.employeeId}:${b.leaveTypeId}`, b]));
  const accrualMap = new Map(accrualSums.map(s => [`${s.employeeId}:${s.leaveTypeId}`, s._sum.deltaMinutes ?? 0]));
  const approvedMap = new Map<string, number>();
  for (const r of approvedLeave) {
    const k = `${r.employeeId}:${r.leaveTypeId}`;
    approvedMap.set(k, (approvedMap.get(k) ?? 0) + r.durationMinutes);
  }

  type Policy = typeof catLinks[0]["ptoPolicy"];

  function computeForecast(policy: Policy, emp: typeof employees[0], leaveTypeId: string, alreadyAccrued: number): number | null {
    const tiers = policy.rules.filter(r => r.leaveTypeId === leaveTypeId);
    if (!tiers.length) return null;

    const basisRaw =
      policy.serviceMonthBasis === "ADJUSTED_HIRE_DATE" ? (emp.adjustedHireDate ?? emp.hireDate) :
      policy.serviceMonthBasis === "TITLE_CHANGE_DATE"  ? (emp.titleChangeDate  ?? emp.hireDate) :
      policy.serviceMonthBasis === "ORIENTATION_DATE"   ? (emp.orientationDate  ?? emp.hireDate) :
      policy.serviceMonthBasis === "USER_DATE_2"        ? (emp.userDate2        ?? emp.hireDate) :
      emp.hireDate;
    const basisDate = new Date(basisRaw);
    const cycleAnchor = policy.postingAnchorDate ? new Date(policy.postingAnchorDate) : basisDate;
    const todayUtc = utcDay(today);

    const fcMode = policy.forecastMode ?? "END_OF_YEAR";
    const fcMonths = policy.forecastMonths;
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
    const currentTier = tiers.find(t => t.minTenureMonths <= tenureMonths && (t.maxTenureMonths === null || tenureMonths < t.maxTenureMonths));
    if (!currentTier) return 0;

    const effectiveHours = currentTier.annualHours + tenureYears * currentTier.earnedHoursPerYear;
    if (effectiveHours <= 0) return 0;

    const annualCapMins = policy.rateMode === "YEARLY" ? Math.round(effectiveHours * 60) : null;
    const remainingBudget = annualCapMins !== null ? Math.max(0, annualCapMins - alreadyAccrued) : null;
    if (remainingBudget !== null && remainingBudget <= 0) return 0;

    const freq = policy.posting1Freq;
    let forecastMins: number;

    if (freq === "PER_PAY_PERIOD") {
      if (policy.rateMode !== "YEARLY") return null;
      const daysRem = Math.max(0, Math.floor((forecastEndDate.getTime() - todayUtc.getTime()) / ms));
      forecastMins = Math.round(effectiveHours * 60 / daysInYear * daysRem);
    } else {
      function countAnchored(period: number): number {
        const aDay = Math.floor(cycleAnchor.getTime() / ms);
        const fDay = Math.floor(forecastStart.getTime() / ms);
        const tDay = Math.floor(forecastEndDate.getTime() / ms);
        const firstIdx = Math.ceil((fDay - aDay) / period);
        const firstDay = aDay + firstIdx * period;
        if (firstDay > tDay) return 0;
        return Math.floor((tDay - firstDay) / period) + 1;
      }
      function countCalendar(monthDays: [number, number][]): number {
        let count = 0;
        for (let y = forecastStart.getUTCFullYear(); y <= forecastEndDate.getUTCFullYear(); y++) {
          for (const [m, d] of monthDays) {
            const p = new Date(Date.UTC(y, m, d));
            if (p >= forecastStart && p <= forecastEndDate) count++;
          }
        }
        return count;
      }
      let postings = 0;
      if (freq === "BI_WEEKLY")     postings = countAnchored(14);
      else if (freq === "WEEKLY")   postings = countAnchored(7);
      else if (freq === "SEMI_MONTHLY") { const md: [number,number][] = []; for (let mo=0;mo<12;mo++) md.push([mo,1],[mo,15]); postings = countCalendar(md); }
      else if (freq === "MONTHLY")  postings = countCalendar(Array.from({length:12},(_,mo)=>[mo,1] as [number,number]));

      const annualMins = effectiveHours * 60;
      const ratePerPosting = policy.rateMode === "PER_POSTING"
        ? Math.round(effectiveHours * 60)
        : freq === "BI_WEEKLY"    ? Math.round(annualMins/26)
        : freq === "SEMI_MONTHLY" ? Math.round(annualMins/24)
        : freq === "MONTHLY"      ? Math.round(annualMins/12)
        : freq === "WEEKLY"       ? Math.round(annualMins/52)
        : Math.round(annualMins/26);
      forecastMins = postings * ratePerPosting;
    }

    return remainingBudget !== null ? Math.min(forecastMins, remainingBudget) : forecastMins;
  }

  const toH = (m: number) => {
    const h = Math.floor(Math.abs(m)/60);
    const min = Math.abs(m)%60;
    return `${m < 0 ? "-" : ""}${h}h${min.toString().padStart(2,"0")}m`;
  };

  console.log(`\nPTO Forecast Comparison — ${YEAR}  (run: ${today.toISOString().slice(0,10)})`);
  console.log("=".repeat(115));
  // Nova data keyed by employee code (without D0F prefix) → { available, used }
  const novaData: Record<string, { available: number; used: number }> = {
    "601147": { available: 44.12,  used: 76.00  }, // Marte        PTNXGA2
    "601908": { available: 22.68,  used: 55.86  }, // Gonzalez Torres PTNXGA2
    "603963": { available: 43.84,  used: 104.00 }, // Williams      PTOEX8GA
    "604423": { available: -4.84,  used: 88.00  }, // McKinney      PTNXGA2
    "606554": { available: 58.41,  used: 58.63  }, // Sanders       PTOEX8GA
    "606732": { available: 0.00,   used: 72.00  }, // Salazar       PTNXGA2
    "606866": { available: 87.78,  used: 0.00   }, // Khandale      PTNXGA2
    "606967": { available: 42.88,  used: 68.00  }, // Krajewski     PTOEX8GA
    "607720": { available: 7.78,   used: 80.00  }, // Alejandre Cruz PTNXGA2
    "608091": { available: 10.88,  used: 100.00 }, // Suitter       PTOEX8GA
  };

  const hToM = (h: number) => Math.round(h * 60);

  console.log(`\nPTO Forecast Comparison — ${YEAR}  (run: ${today.toISOString().slice(0,10)})`);
  console.log("=".repeat(148));
  console.log(
    "Code    ".padEnd(8) +
    "Name                   ".padEnd(24) +
    "Policy    ".padEnd(10) +
    "FC?  ".padEnd(5) +
    "Accrued   ".padEnd(11) +
    "Forecast  ".padEnd(10) +
    "Accrued+FC  ".padEnd(12) +
    "NovaAvail ".padEnd(10) +
    "NovaUsed  ".padEnd(10) +
    "NovaTotal  ".padEnd(11) +
    "GapBefore   ".padEnd(12) +
    "GapAfterFC"
  );
  console.log("-".repeat(148));

  // Find the PTO leave type (name contains "PTO" but not "Carry Over" / "Sick")
  const ptoLeaveType = leaveTypes.find(lt =>
    /\bpto\b/i.test(lt.name) && !/carry.?over|sick/i.test(lt.name)
  );

  if (!ptoLeaveType) { console.log("Could not find PTO leave type"); process.exit(1); }

  const fmtDelta = (d: number | null) =>
    d === null ? "N/A" : `${d >= 0 ? "+" : ""}${toH(d)}`;

  for (const emp of employees.sort((a,b)=>(a.employeeCode??'').localeCompare(b.employeeCode??''))) {
    const rawCode = (emp.employeeCode ?? '').replace(/^D0F/, '');
    const nova = novaData[rawCode];

    const policy = getPolicyForLeaveType(emp.id, emp.payCategoryId, ptoLeaveType.id);

    const bal      = balanceMap.get(`${emp.id}:${ptoLeaveType.id}`);
    const accrued  = accrualMap.get(`${emp.id}:${ptoLeaveType.id}`) ?? 0;
    const approved = approvedMap.get(`${emp.id}:${ptoLeaveType.id}`) ?? 0;
    const balance  = bal?.balanceMinutes ?? 0;
    const available = balance - approved;

    let forecasted: number | null = null;
    if (policy?.forecastEnabled) {
      forecasted = computeForecast(policy, emp, ptoLeaveType.id, accrued);
    }

    const accruedPlusFc = accrued + (forecasted ?? 0);

    const novaAvailM  = nova ? hToM(nova.available) : null;
    const novaUsedM   = nova ? hToM(nova.used)      : null;
    const novaTotalM  = nova ? hToM(nova.available + nova.used) : null;

    // Gap = NovaTotal - OurAccrued; does adding forecast close it?
    const gapBeforeFC = novaTotalM != null ? novaTotalM - accrued : null;
    const gapAfterFC  = novaTotalM != null ? novaTotalM - accruedPlusFc : null;

    console.log(
      rawCode.padEnd(8) +
      (emp.user.name??'').substring(0,23).padEnd(24) +
      (policy?.name??'none').substring(0,9).padEnd(10) +
      (policy?.forecastEnabled ? "YES" : "no ").padEnd(5) +
      toH(accrued).padEnd(11) +
      (forecasted != null ? toH(forecasted) : "---").padEnd(10) +
      toH(accruedPlusFc).padEnd(12) +
      (novaAvailM != null ? toH(novaAvailM) : "N/A").padEnd(10) +
      (novaUsedM  != null ? toH(novaUsedM)  : "N/A").padEnd(10) +
      (novaTotalM != null ? toH(novaTotalM) : "N/A").padEnd(11) +
      fmtDelta(gapBeforeFC).padEnd(12) +
      fmtDelta(gapAfterFC)
    );
  }

}

main().catch(e => { console.error(e); process.exit(1); });
