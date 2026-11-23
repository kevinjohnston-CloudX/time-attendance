/**
 * New hires whose waiting period ended between the 10/22 NovaTime rebuild and
 * today. The rebuild wrote what NovaTime held for them as accruals that never
 * reached the balance (Banchon's six 1.54 h PTO rows, a 40 h Sick row), and
 * NovaTime's release came after it. Each is released here as the engine now
 * does (accrual-engine, WAIT_RELEASE_NOTE): an adjustment of the held rows,
 * dated the release day, capped at the policy's maximum balance.
 *
 *   TZ=UTC npx tsx scripts/fix-waiting-period-release.ts           dry run
 *   TZ=UTC npx tsx scripts/fix-waiting-period-release.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import * as XLSX from "xlsx";

const APPLY = process.argv.includes("--apply");
const T = "cmm9mxrup0000kgug6sa5gw53";
// After the 10/27 re-sync, which already carried NovaTime's releases up to then.
const REBUILD = new Date("2026-10-28T00:00:00Z");
const TODAY = new Date("2026-11-20T00:00:00Z");
// The waiting periods the migration sets; read here by name so this runs before it is applied.
const WAITS: Record<string, number> = { NJPTO25: 3, PTO160: 3, SCKNX8NJ: 3 };
const CYCLE = 14 * 86_400_000;

async function main() {
  const { db } = await import("@/lib/db");
  const { waitEnds, WAIT_RELEASE_NOTE } = await import("@/lib/engines/accrual-engine");
  const iso = (s: string) => { const [m, d, y] = String(s).split("/").map(Number); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };

  // NovaTime's available on the cutoff, for the cross-check.
  const wb = XLSX.readFile("C:/Users/john.raefski/Downloads/Accruals 11.21.2026.xls");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["History Report.ACC"], { defval: "" });
  const LT: Record<string, string> = { "5[PTO]": "lt-pto", "42[NJSK]": "lt-sick" };
  const novaAvail = new Map<string, number>();
  for (const r of rows) {
    const lt = LT[String(r.Paycode)]; if (!lt || iso(String(r["Post Date"])) > "2026-11-20") continue;
    novaAvail.set(`${String(r["Employee ID (only)"]).trim()}|${lt}`, Number(r["Available Balance"]) || 0);
  }

  const policies = await db.ptoPolicy.findMany({
    where: { tenantId: T, name: { in: Object.keys(WAITS) } },
    select: { name: true, posting1Freq: true, postingAnchorDate: true, rules: { select: { leaveTypeId: true, minTenureMonths: true, maxBalanceHours: true } }, categoryLinks: { select: { payCategoryId: true } } },
  });
  let count = 0, total = 0;
  for (const p of policies) {
    const lt = p.rules[0].leaveTypeId;
    const maxBal = p.rules.find((r) => r.maxBalanceHours != null)?.maxBalanceHours ?? null;
    const emps = await db.employee.findMany({
      where: { isActive: true, payCategoryId: { in: p.categoryLinks.map((c) => c.payCategoryId) }, hireDate: { gte: new Date("2026-06-01") } },
      select: { id: true, wmsId: true, employeeCode: true, hireDate: true, user: { select: { name: true } } },
    });
    for (const e of emps) {
      const end = waitEnds(e.hireDate, WAITS[p.name]);
      // The release day: the wait's own day for a yearly grant, the first fortnightly posting on or after it for PTO.
      let release = end;
      if (p.posting1Freq === "BI_WEEKLY") {
        const anchor = p.postingAnchorDate!.getTime();
        release = new Date(anchor + Math.ceil((end.getTime() - anchor) / CYCLE) * CYCLE);
      }
      if (release < REBUILD || release > TODAY) continue;
      const released = await db.leaveAccrualLedger.findFirst({ where: { employeeId: e.id, leaveTypeId: lt, note: { startsWith: WAIT_RELEASE_NOTE } }, select: { id: true } });
      if (released) continue;
      const hireDay = new Date(Date.UTC(e.hireDate.getUTCFullYear(), e.hireDate.getUTCMonth(), e.hireDate.getUTCDate()));
      const held = await db.leaveAccrualLedger.aggregate({ where: { employeeId: e.id, leaveTypeId: lt, action: "ACCRUAL", note: "System Accrual Hours", payPeriodEnd: { gte: hireDay, lt: release } }, _sum: { deltaSeconds: true } });
      const heldSeconds = held._sum.deltaSeconds ?? 0;
      if (heldSeconds <= 0) continue;
      const bal = await db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_accrualYear: { employeeId: e.id, leaveTypeId: lt, accrualYear: 2026 } } });
      const before = bal?.balanceSeconds ?? 0;
      const after = maxBal != null ? Math.min(before + heldSeconds, Math.round(maxBal * 3600)) : before + heldSeconds;
      const delta = after - before;
      if (delta <= 0) continue;
      const nova = novaAvail.get(`${e.wmsId ?? e.employeeCode}|${lt}`);
      console.log(`${APPLY ? "RELEASE" : "would release"} ${p.name.padEnd(8)} ${e.user.name.padEnd(34)} hired ${e.hireDate.toISOString().slice(0, 10)} released ${release.toISOString().slice(0, 10)}: +${(delta / 3600).toFixed(2)} (held ${(heldSeconds / 3600).toFixed(2)}), balance ${(before / 3600).toFixed(2)} -> ${(after / 3600).toFixed(2)} | NovaTime ${nova ?? "?"}`);
      count++; total += delta;
      if (!APPLY) continue;
      await db.$transaction(async (tx) => {
        const b = await tx.leaveBalance.upsert({
          where: { employeeId_leaveTypeId_accrualYear: { employeeId: e.id, leaveTypeId: lt, accrualYear: 2026 } },
          create: { employeeId: e.id, leaveTypeId: lt, accrualYear: 2026 }, update: {},
        });
        const now = b.balanceSeconds + delta;
        await tx.leaveBalance.update({ where: { id: b.id }, data: { balanceSeconds: now } });
        await tx.leaveAccrualLedger.create({ data: { employeeId: e.id, leaveTypeId: lt, action: "ADJUSTMENT", deltaSeconds: delta, balanceAfterSeconds: now, payPeriodEnd: release, note: `${WAIT_RELEASE_NOTE}: held since hire` } });
      });
    }
  }
  console.log({ apply: APPLY, releases: count, hours: (total / 3600).toFixed(2) });
}
main().then(() => process.exit(0));
