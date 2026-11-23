/**
 * Engine postings that landed one tier low because tenure counted from the
 * hire date's 04:00/05:00 instant (serviceMonths now counts from its day).
 * Each gets an Earned Adj. of the difference, dated the posting's day.
 *
 *   TZ=UTC npx tsx scripts/fix-accrual-tenure-step.ts           dry run
 *   TZ=UTC npx tsx scripts/fix-accrual-tenure-step.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { differenceInMonths } from "date-fns";

const APPLY = process.argv.includes("--apply");
const NOTE = "Tenure step on hire anniversary";

async function main() {
  const { db } = await import("@/lib/db");
  const { serviceMonths } = await import("@/lib/engines/accrual-engine");
  const { hoursToSeconds } = await import("@/lib/leave-time");

  const postings = await db.leaveAccrualLedger.findMany({
    where: { action: "ACCRUAL", note: null },
    select: { employeeId: true, leaveTypeId: true, deltaSeconds: true, payPeriodEnd: true, leaveType: { select: { name: true } } },
  });
  const emps = await db.employee.findMany({
    where: { id: { in: [...new Set(postings.map((p) => p.employeeId))] } },
    select: { id: true, tenantId: true, siteId: true, payCategoryId: true, hireDate: true, adjustedHireDate: true, user: { select: { name: true } } },
  });
  const empById = new Map(emps.map((e) => [e.id, e]));
  const [catLinks, siteLinks, defaults, done] = await Promise.all([
    db.payCategoryPtoPolicy.findMany({ select: { payCategoryId: true, ptoPolicy: { select: { name: true, isActive: true, serviceMonthBasis: true, rateMode: true, rules: true } } } }),
    db.sitePtoPolicy.findMany({ select: { siteId: true, leaveTypeId: true, ptoPolicy: { select: { name: true, serviceMonthBasis: true, rateMode: true, rules: true } } } }),
    db.ptoPolicy.findMany({ where: { isDefault: true, isActive: true }, select: { tenantId: true, name: true, serviceMonthBasis: true, rateMode: true, rules: true } }),
    db.leaveAccrualLedger.findMany({ where: { action: "EARNED_ADJUSTMENT", note: NOTE }, select: { employeeId: true, leaveTypeId: true, payPeriodEnd: true } }),
  ]);
  const doneKeys = new Set(done.map((d) => `${d.employeeId}|${d.leaveTypeId}|${d.payPeriodEnd?.toISOString().slice(0, 10)}`));

  let count = 0, total = 0;
  for (const p of postings) {
    const e = empById.get(p.employeeId)!;
    const pol =
      catLinks.find((l) => l.payCategoryId === e.payCategoryId && l.ptoPolicy.isActive && l.ptoPolicy.rules.some((r) => r.leaveTypeId === p.leaveTypeId))?.ptoPolicy ??
      siteLinks.find((s) => s.siteId === e.siteId && s.leaveTypeId === p.leaveTypeId)?.ptoPolicy ??
      defaults.find((d) => d.tenantId === e.tenantId && d.rules.some((r) => r.leaveTypeId === p.leaveTypeId));
    if (!pol || pol.rateMode !== "PER_POSTING") continue;
    const basis = pol.serviceMonthBasis === "ADJUSTED_HIRE_DATE" ? (e.adjustedHireDate ?? e.hireDate) : e.hireDate;
    // What the engine counted then (UTC process, the 04:00/05:00 instant) against the hire day.
    const used = differenceInMonths(p.payPeriodEnd!, basis), right = serviceMonths(p.payPeriodEnd!, basis);
    if (used === right) continue;
    const tiers = pol.rules.filter((r) => r.leaveTypeId === p.leaveTypeId).sort((a, b) => a.minTenureMonths - b.minTenureMonths);
    const tier = (m: number) => tiers.find((t) => t.minTenureMonths <= m && (t.maxTenureMonths === null || m < t.maxTenureMonths));
    const got = tier(used)?.annualHours ?? 0, should = tier(right)?.annualHours ?? 0;
    // Only where the posting was the old tier's amount: anything else was not this.
    if (Math.abs(got - should) < 0.005 || p.deltaSeconds !== hoursToSeconds(got)) continue;
    const day = p.payPeriodEnd!.toISOString().slice(0, 10);
    if (doneKeys.has(`${e.id}|${p.leaveTypeId}|${day}`)) continue;
    const diff = hoursToSeconds(should) - hoursToSeconds(got);
    console.log(`${APPLY ? "ADD" : "would add"} ${e.user.name.padEnd(24)} ${day} ${p.leaveType.name} ${pol.name}: posted ${got}, tier ${should}, +${(diff / 3600).toFixed(2)}`);
    count++; total += diff;
    if (!APPLY) continue;
    await db.$transaction(async (tx) => {
      const bal = await tx.leaveBalance.findUniqueOrThrow({ where: { employeeId_leaveTypeId_accrualYear: { employeeId: e.id, leaveTypeId: p.leaveTypeId, accrualYear: p.payPeriodEnd!.getUTCFullYear() } } });
      const after = bal.balanceSeconds + diff;
      await tx.leaveBalance.update({ where: { id: bal.id }, data: { balanceSeconds: after } });
      await tx.leaveAccrualLedger.create({
        data: { employeeId: e.id, leaveTypeId: p.leaveTypeId, action: "EARNED_ADJUSTMENT", deltaSeconds: diff, balanceAfterSeconds: after, payPeriodEnd: p.payPeriodEnd, note: NOTE },
      });
    });
  }
  console.log({ apply: APPLY, entries: count, hours: (total / 3600).toFixed(2) });
}
main().then(() => process.exit(0));
