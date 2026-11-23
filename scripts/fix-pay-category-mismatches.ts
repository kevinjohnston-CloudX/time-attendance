/**
 * People whose pay category here gives a different PTO policy than NovaTime's
 * (most from pay category changes made in NovaTime after the 10/22 rebuild).
 * Moves each to the category carrying NovaTime's policy, as the employee
 * editor does (audit entry, "Policy changed to" ledger markers), and adds an
 * Earned Adj. for each posting since where NovaTime's accrual differs from ours.
 *
 *   TZ=UTC npx tsx scripts/fix-pay-category-mismatches.ts           dry run
 *   TZ=UTC npx tsx scripts/fix-pay-category-mismatches.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import * as XLSX from "xlsx";

const APPLY = process.argv.includes("--apply");
const T = "cmm9mxrup0000kgug6sa5gw53";
const ACTOR_NAME = "John Raefski";
const NOTE = "NovaTime pay category change";
const SINCE = "2026-10-24"; // the first posting after the rebuild NovaTime's changes reached

// id → category number here carrying NovaTime's policy for them.
const MOVES: Record<string, { from: number; to: number; why: string }> = {
  "908665": { from: 10, to: 12, why: "NovaTime PTOEXSCA from 10/24" },          // Juan Medina: Ca Non Exempt -> Ca Exempt
  "102948": { from: 21, to: 299, why: "NovaTime NJPTO25 from 10/02" },          // Raul Huaman Encalada: NJ Non Exempt 8 -> New Jersey - 299
  "102015": { from: 21, to: 590, why: "NovaTime NJPTO25 since hire" },          // Kenluis K Payano: NJ Non Exempt 8 -> New Jersey - 5903
  "362317": { from: 13, to: 10, why: "NovaTime PTNEXCA2 since hire" },          // Misael Avila: Ca Temp -> Ca Non Exempt
  "604824": { from: 700, to: 704, why: "NovaTime PTNGA2N since hire" },          // Jeremy Osoria Collado: GA Non Exempt -> 2025+ New Hire
  "600258": { from: 700, to: 704, why: "NovaTime PTNGA2N since hire" },          // Marcus Tucker: GA Non Exempt -> 2025+ New Hire
};

async function main() {
  const { db } = await import("@/lib/db");
  const { writeAuditLog } = await import("@/lib/audit/logger");
  const iso = (s: string) => { const [m, d, y] = String(s).split("/").map(Number); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
  const wb = XLSX.readFile("C:/Users/john.raefski/Downloads/Accruals 11.21.2026.xls");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["History Report.ACC"], { defval: "" });
  // The audit actor and ledger creator are an employee id, as the employee editor records them.
  const actor = await db.employee.findFirstOrThrow({ where: { tenantId: T, user: { name: ACTOR_NAME } }, select: { id: true } });
  const cats = await db.payCategory.findMany({ where: { tenantId: T }, select: { id: true, number: true, description: true, ptoPolicies: { select: { ptoPolicy: { select: { name: true, rules: { select: { leaveTypeId: true } } } } } } } });
  const fmt = (c: (typeof cats)[number] | undefined) => (c ? `${c.number}${c.description ? ` (${c.description})` : ""}` : "—");

  for (const [id, move] of Object.entries(MOVES)) {
    const e = await db.employee.findFirstOrThrow({ where: { tenantId: T, OR: [{ wmsId: id }, { employeeCode: id }] }, select: { id: true, payCategoryId: true, user: { select: { name: true } } } });
    // The category they were on before this script, for the audit entry even when already moved.
    const from = cats.find((c) => c.number === move.from), to = cats.find((c) => c.number === move.to)!;
    const already = e.payCategoryId === to.id;
    if (!already && e.payCategoryId !== from?.id) { console.log(`\n${e.user.name}: not on ${fmt(from)} any more, skipped`); continue; }
    console.log(`\n${e.user.name} (${id}): ${fmt(from)} [${from?.ptoPolicies.map((p) => p.ptoPolicy.name).join(", ") || "no policies"}] -> ${fmt(to)} [${to.ptoPolicies.map((p) => p.ptoPolicy.name).join(", ")}]${already ? " (already)" : ""}  — ${move.why}`);

    // Accrual differences per posting since SINCE: NovaTime's S rows against our ACCRUAL + EARNED_ADJUSTMENT.
    const nova = new Map<string, number>();
    for (const r of rows) {
      if (String(r["Employee ID (only)"]).trim() !== id || r["Post Type"] !== "S" || String(r.Paycode) !== "5[PTO]") continue;
      const d = iso(String(r["Post Date"])); if (d < SINCE || d > "2026-11-20") continue;
      nova.set(d, (nova.get(d) ?? 0) + Math.round(Number(r["Accrual Hours"]) * 3600));
    }
    const ours = await db.leaveAccrualLedger.findMany({ where: { employeeId: e.id, leaveTypeId: "lt-pto", action: { in: ["ACCRUAL", "EARNED_ADJUSTMENT"] }, payPeriodEnd: { gte: new Date(SINCE), lte: new Date("2026-11-20") } }, select: { deltaSeconds: true, payPeriodEnd: true, note: true } });
    const ourBy = new Map<string, number>();
    for (const o of ours) { const d = o.payPeriodEnd!.toISOString().slice(0, 10); ourBy.set(d, (ourBy.get(d) ?? 0) + o.deltaSeconds); }
    const done = ours.some((o) => o.note?.startsWith(NOTE));
    // NJPTO25 holds a new hire's PTO: NovaTime's accrual is earned, not available, until the wait ends.
    const held = (await db.employee.findUniqueOrThrow({ where: { id: e.id }, select: { hireDate: true } })).hireDate > new Date("2026-08-20") && to.ptoPolicies.some((p) => p.ptoPolicy.name === "NJPTO25");
    const fixes: { day: string; seconds: number }[] = [];
    if (held) {
      // Under the hold nothing is available yet. The rebuild's rows never reached
      // the balance; only our own postings (no note) did, and those come back off.
      for (const o of ours) if (o.note === null && o.deltaSeconds > 0) fixes.push({ day: o.payPeriodEnd!.toISOString().slice(0, 10), seconds: -o.deltaSeconds });
    } else {
      for (const d of [...new Set([...nova.keys(), ...ourBy.keys()])].sort()) {
        const want = nova.get(d) ?? 0, have = ourBy.get(d) ?? 0;
        if (want !== have) fixes.push({ day: d, seconds: want - have });
      }
    }
    for (const f of fixes) console.log(`   ${done ? "(done)" : APPLY ? "ADD" : "would add"} Earned Adj. ${f.day} ${(f.seconds / 3600).toFixed(2)} h${held ? " (NJPTO25 holds it until the wait ends)" : ""}`);
    if (!fixes.length) console.log("   no accrual difference");

    if (!APPLY) continue;
    if (!already) {
      await db.employee.update({ where: { id: e.id }, data: { payCategoryId: to.id } });
      const seen = new Set<string>();
      for (const link of to.ptoPolicies) for (const lt of new Set(link.ptoPolicy.rules.map((r) => r.leaveTypeId))) {
        if (seen.has(lt)) continue; seen.add(lt);
        const bal = await db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_accrualYear: { employeeId: e.id, leaveTypeId: lt, accrualYear: 2026 } }, select: { balanceSeconds: true } });
        await db.leaveAccrualLedger.create({ data: { employeeId: e.id, leaveTypeId: lt, action: "POLICY_CHANGE", deltaSeconds: 0, balanceAfterSeconds: bal?.balanceSeconds ?? 0, note: `Policy changed to ${link.ptoPolicy.name}`, createdById: actor.id } });
      }
    }
    // The audit entry, once (a first run that stopped after the move left it out).
    const audited = (await db.auditLog.findMany({ where: { entityId: e.id, action: "EMPLOYEE_UPDATED", createdAt: { gte: new Date("2026-11-20T00:00:00Z") } }, select: { changes: true } }))
      .some((a) => JSON.stringify(a.changes ?? "").includes(NOTE));
    if (!audited) {
      await writeAuditLog({ tenantId: T, actorId: actor.id, entityType: "EMPLOYEE", entityId: e.id, action: "EMPLOYEE_UPDATED", changes: { fields: [{ field: "Pay Category", before: fmt(from), after: fmt(to) }], reason: `${NOTE}: ${move.why}` } });
    }
    if (done) continue;
    for (const f of fixes) {
      await db.$transaction(async (tx) => {
        const b = await tx.leaveBalance.findUniqueOrThrow({ where: { employeeId_leaveTypeId_accrualYear: { employeeId: e.id, leaveTypeId: "lt-pto", accrualYear: 2026 } } });
        const after = b.balanceSeconds + f.seconds;
        await tx.leaveBalance.update({ where: { id: b.id }, data: { balanceSeconds: after } });
        await tx.leaveAccrualLedger.create({ data: { employeeId: e.id, leaveTypeId: "lt-pto", action: "EARNED_ADJUSTMENT", deltaSeconds: f.seconds, balanceAfterSeconds: after, payPeriodEnd: new Date(`${f.day}T00:00:00Z`), note: `${NOTE}: ${move.why}`, createdById: actor.id } });
      });
    }
  }
  console.log(`\n${APPLY ? "applied" : "dry run"}`);
}
main().then(() => process.exit(0));
