/**
 * The last load of NovaTime leave (Accruals 11.21.2026.xls), 11/20.
 *
 * Every NovaTime leave day (Post Type T) is matched against what is here, and
 * only the gap is acted on, once:
 *   A. on the timecard here (our request) but never charged: charge that request;
 *   B. not here at all: add it as Add time does (approved request of NovaTime's
 *      type, charged once, on the timecard, audit entry, timecard note);
 *   C. charged here (NovaTime's own usage) but on no open timecard: put the
 *      imported entry on the timecard, no new charge.
 * Left alone: days that already line up; days in locked periods (payroll has
 * run); the days HR is deciding (SKIP); and anything that does not fit its
 * group cleanly, which is listed. NovaTime's accrual rows are not loaded: the
 * engine posts its own (11/21 included).
 *
 *   TZ=UTC npx tsx scripts/novatime-final-leave-load.ts           dry run
 *   TZ=UTC npx tsx scripts/novatime-final-leave-load.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import * as XLSX from "xlsx";

const APPLY = process.argv.includes("--apply");
const T = "cmm9mxrup0000kgug6sa5gw53";
const ACTOR_NAME = "John Raefski";
const NOTE = "From NovaTime (final load)";
const PTOC = "cmq74gsfc000104l7f0ezns2o";
const LT: Record<string, string> = { "5[PTO]": "lt-pto", "41[PTOC]": PTOC, "42[NJSK]": "lt-sick", "3[CASK]": "lt-sick" };
const NAME: Record<string, string> = { "lt-pto": "PTO", [PTOC]: "PTO Carry Over", "lt-sick": "Sick Leave" };
const ERA = "2026-09-13";
// HR is deciding these (11/20): NovaTime and the timecard disagree.
const SKIP = new Set([
  "117767|2026-11-19", "117767|2026-11-20", // Sofia Vera: worked, PTO cancelled here
  "600060|2026-11-10",                      // Deborah Whitaker: salaried day
  "908552|2026-11-02",                      // Joshua Galindo: salaried day
  "904576|2026-10-13", "904576|2026-10-19", // Leticia Martinez: Unpaid Time Off here
  "606966|2026-11-06",                      // Idalmis Vega: PTO request here, PTOC in NovaTime
  "105871|2026-11-12",                      // Ezequiel Peralta: 2.75 here, 2.84 in NovaTime
]);
const iso = (s: string) => { const [m, d, y] = String(s).split("/").map(Number); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const near = (a: number, b: number) => Math.abs(a - b) <= 36;
const h = (s: number) => (s / 3600).toFixed(2);

async function main() {
  const { db } = await import("@/lib/db");
  const { postLeaveUsage } = await import("@/lib/engines/accrual-engine");
  const { placeLeave } = await import("@/lib/engines/leave-recalc");
  const { availabilityFor, leaveTypeAllowed } = await import("@/lib/pay-code-availability");
  const { noteTimecardChange, hoursLabel } = await import("@/lib/timecards/change-note");
  const { writeAuditLog } = await import("@/lib/audit/logger");
  const actor = await db.employee.findFirstOrThrow({ where: { tenantId: T, user: { name: ACTOR_NAME } }, select: { id: true } });

  const wb = XLSX.readFile("C:/Users/john.raefski/Downloads/Accruals 11.21.2026.xls");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["History Report.ACC"], { defval: "" });
  const emps = await db.employee.findMany({ where: { tenantId: T }, select: { id: true, employeeCode: true, wmsId: true, isActive: true, user: { select: { name: true } } } });
  const byCode = new Map(emps.map((e) => [e.employeeCode, e])), byWms = new Map(emps.filter((e) => e.wmsId).map((e) => [e.wmsId!, e]));
  const empById = new Map(emps.map((e) => [e.id, e]));

  // NovaTime leave per person, type and day, since CloudTime timecards (repeated report lines once).
  const seen = new Set<string>();
  const nova = new Map<string, number>();
  for (const r of rows) {
    if (r["Post Type"] !== "T") continue;
    const lt = LT[String(r.Paycode)]; if (!lt) continue;
    const code = String(r["Employee ID (only)"]).trim();
    const k0 = `${code}|${r.Paycode}|${r["Post Date"]}|${r["Used Hours"]}|${r["Available Balance"]}`;
    if (seen.has(k0)) continue; seen.add(k0);
    const e = byCode.get(code) ?? byWms.get(code); if (!e) continue;
    const day = iso(String(r["Post Date"])); if (day < ERA) continue;
    const k = `${e.id}|${lt}|${day}`;
    nova.set(k, (nova.get(k) ?? 0) + Math.round(Number(r["Used Hours"]) * 3600));
  }
  const empIds = [...new Set([...nova.keys()].map((k) => k.split("|")[0]))];
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  // Charged here, by day: NovaTime's usage rows (no request), and every request's net debit.
  const charged = new Map<string, number>();
  for (const u of await db.leaveAccrualLedger.findMany({ where: { employeeId: { in: empIds }, action: "USAGE", leaveRequestId: null }, select: { employeeId: true, leaveTypeId: true, deltaSeconds: true, payPeriodEnd: true } }))
    if (u.payPeriodEnd) add(charged, `${u.employeeId}|${u.leaveTypeId}|${u.payPeriodEnd.toISOString().slice(0, 10)}`, -u.deltaSeconds);
  const reqs = await db.leaveRequest.findMany({
    where: { employeeId: { in: empIds }, startDate: { gte: new Date(`${ERA}T00:00:00Z`) } },
    select: { id: true, employeeId: true, leaveTypeId: true, startDate: true, endDate: true, status: true, note: true, durationSeconds: true, ledgerEntries: { select: { action: true, deltaSeconds: true } }, segments: { select: { id: true }, take: 1 } },
  });
  const net = (r: (typeof reqs)[number]) => -r.ledgerEntries.filter((l) => ["USAGE", "TIMECARD_DEDUCTION", "ADJUSTMENT"].includes(l.action)).reduce((a, l) => a + l.deltaSeconds, 0);
  for (const r of reqs) { const n = net(r); if (n && (r.status !== "CANCELLED" || r.note === "novatime-import")) add(charged, `${r.employeeId}|${r.leaveTypeId}|${r.startDate.toISOString().slice(0, 10)}`, n); }
  const live = reqs.filter((r) => r.status !== "CANCELLED");

  // On the timecard, by day: leave lines of the type, and hours under a leave pay code of it.
  const payCodes = await db.payCode.findMany({ where: { tenantId: T }, select: { id: true, expressCode: true, payBucket: true } });
  const codeType = new Map<string, string>();
  for (const p of payCodes) {
    if (p.expressCode === "PTO") codeType.set(p.id, "lt-pto");
    else if (p.expressCode === "PTOC") codeType.set(p.id, PTOC);
    else if (p.payBucket === "SICK") codeType.set(p.id, "lt-sick");
  }
  const onCard = new Map<string, number>();
  for (const s of await db.workSegment.findMany({
    where: { timesheet: { employeeId: { in: empIds } }, segmentDate: { gte: new Date(`${ERA}T00:00:00Z`) }, durationMinutes: { gt: 0 }, OR: [{ segmentType: "LEAVE" }, { payCodeId: { in: [...codeType.keys()] } }] },
    select: { durationSeconds: true, durationMinutes: true, segmentDate: true, payCodeId: true, leaveRequest: { select: { leaveTypeId: true } }, timesheet: { select: { employeeId: true } } },
  })) {
    const lt = s.leaveRequest?.leaveTypeId ?? (s.payCodeId ? codeType.get(s.payCodeId) : undefined);
    if (lt) add(onCard, `${s.timesheet.employeeId}|${lt}|${s.segmentDate.toISOString().slice(0, 10)}`, s.durationSeconds ?? s.durationMinutes * 60);
  }
  // Each day's timecard, or its period when there is none yet.
  const sheets = await db.timesheet.findMany({ where: { employeeId: { in: empIds }, payPeriod: { endDate: { gte: new Date(`${ERA}T00:00:00Z`) } } }, select: { id: true, employeeId: true, status: true, payPeriod: { select: { startDate: true, endDate: true } } } });
  const sheetOn = (empId: string, day: string) => sheets.find((t) => t.employeeId === empId && t.payPeriod.startDate.toISOString().slice(0, 10) <= day && t.payPeriod.endDate.toISOString().slice(0, 10) > day);
  const ruleSets = new Map((await db.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, ruleSetId: true } })).map((e) => [e.id, e.ruleSetId]));
  const periodLocked = async (empId: string, day: string) => {
    const d = new Date(`${day}T00:00:00Z`);
    const pp = await db.payPeriod.findFirst({ where: { ruleSetId: ruleSets.get(empId), startDate: { lte: d }, endDate: { gt: d } }, select: { status: true } });
    return pp?.status === "LOCKED";
  };

  const counts = { A: 0, B: 0, C: 0, skipped: 0, left: 0 };
  const hours = { A: 0, B: 0 };
  for (const [k, ns] of [...nova].sort()) {
    const [empId, lt, day] = k.split("|");
    const e = empById.get(empId)!;
    const code = e.wmsId ?? e.employeeCode;
    const ch = charged.get(k) ?? 0, oc = onCard.get(k) ?? 0;
    const chargedOk = near(ch, ns) || ch > ns, cardOk = near(oc, ns) || oc > ns;
    if (chargedOk && cardOk) continue;
    const label = `${e.user.name.padEnd(30)} ${day} ${NAME[lt].padEnd(14)} NovaTime ${h(ns)}`;
    if (SKIP.has(`${code}|${day}`)) { counts.skipped++; console.log(`HR       ${label}`); continue; }
    const sheet = sheetOn(empId, day);
    const locked = sheet ? ["LOCKED", "PAYROLL_APPROVED"].includes(sheet.status) : await periodLocked(empId, day);
    if (locked) { counts.left++; continue; } // locked periods: left as they are
    if (!e.isActive) { counts.left++; console.log(`LEFT     ${label}: inactive`); continue; }
    const sameDay = live.filter((r) => r.employeeId === empId && r.startDate.toISOString().slice(0, 10) <= day && r.endDate.toISOString().slice(0, 10) >= day);

    if (!chargedOk && cardOk) {
      // A. Ours is on the timecard; charge it, once.
      const ours = sameDay.filter((r) => r.leaveTypeId === lt && r.note !== "novatime-import" && r.segments.length && net(r) === 0 && ["POSTED", "APPROVED"].includes(r.status));
      const total = ours.reduce((a, r) => a + r.durationSeconds, 0);
      if (!ours.length || !near(total + ch, ns)) { counts.left++; console.log(`LEFT     ${label}: on the timecard, but not as one uncharged request of ${h(ns - ch)} h (here: ${ours.map((r) => h(r.durationSeconds)).join("+") || "none"})`); continue; }
      counts.A++; hours.A += total;
      console.log(`${APPLY ? "CHARGE  " : "A charge"} ${label}: request${ours.length > 1 ? "s" : ""} ${ours.map((r) => h(r.durationSeconds)).join("+")} h on the timecard`);
      if (APPLY) for (const r of ours) await postLeaveUsage(r.id);
    } else if (!chargedOk && !cardOk) {
      // B. Not here: add it as Add time does.
      if (ch > 36 || oc > 36) { counts.left++; console.log(`LEFT     ${label}: partly here (charged ${h(ch)}, on the timecard ${h(oc)})`); continue; }
      const others = sameDay.filter((r) => r.note !== "novatime-import");
      if (others.length) { counts.left++; console.log(`LEFT     ${label}: other leave that day here (${others.map((r) => `${r.status} ${h(r.durationSeconds)}`).join(", ")})`); continue; }
      if (!leaveTypeAllowed(await availabilityFor(empId), lt)) { counts.left++; console.log(`LEFT     ${label}: ${NAME[lt]} not allowed by their pay category`); continue; }
      counts.B++; hours.B += ns;
      console.log(`${APPLY ? "ADD     " : "B add   "} ${label}: ${sheet ? `timecard ${sheet.status}` : "timecard made for its period"}`);
      if (!APPLY) continue;
      const now = new Date();
      const req = await db.$transaction(async (tx) => {
        const r = await tx.leaveRequest.create({
          data: { employeeId: empId, leaveTypeId: lt, status: "APPROVED", startDate: new Date(`${day}T00:00:00Z`), endDate: new Date(`${day}T00:00:00Z`), durationSeconds: ns, note: NOTE, submittedAt: now, reviewedAt: now, reviewedById: actor.id },
        });
        await postLeaveUsage(r.id, tx);
        return r;
      });
      await placeLeave(req.id);
      const placedOn = (await db.workSegment.findFirst({ where: { leaveRequestId: req.id }, select: { timesheetId: true } }))?.timesheetId;
      if (placedOn) {
        await writeAuditLog({ tenantId: T, actorId: actor.id, action: "PAYROLL_LEAVE_ADDED", entityType: "TIMESHEET", entityId: placedOn, changes: { after: { leaveRequestId: req.id, leaveTypeId: lt, date: day, hours: ns / 3600 }, reason: NOTE } });
        await noteTimecardChange({ timesheetId: placedOn, day, actorId: actor.id, change: `Added ${hoursLabel(ns / 3600)} ${NAME[lt]}`, note: NOTE });
      } else console.log(`         (no timecard placed for ${req.id}: check)`);
    } else {
      // C. Charged (NovaTime's usage) but not on the timecard: put the imported entry on it.
      // The imported entry when there is one; else the rebuild charged the day
      // straight to the ledger, and a posted entry with no charge of its own shows it.
      const imp = sameDay.filter((r) => r.leaveTypeId === lt && r.note === "novatime-import" && r.status === "POSTED" && !r.segments.length);
      const others = sameDay.filter((r) => r.note !== "novatime-import" && !r.segments.length);
      if (imp.length > 1 || (imp.length === 1 && !near(imp[0].durationSeconds, ns - oc)) || others.length || oc > 36) { counts.left++; console.log(`LEFT     ${label}: charged, not one clean entry to place (imported ${imp.map((r) => h(r.durationSeconds)).join("+") || "none"}, on the timecard ${h(oc)})`); continue; }
      counts.C++;
      console.log(`${APPLY ? "PLACE   " : "C place "} ${label}: ${imp.length ? "imported entry" : "new posted entry, no charge"}, already on the balance, onto timecard ${sheet?.status ?? "(new)"}`);
      if (!APPLY) continue;
      const now = new Date();
      const entry = imp[0] ?? await db.leaveRequest.create({
        data: { employeeId: empId, leaveTypeId: lt, status: "POSTED", startDate: new Date(`${day}T00:00:00Z`), endDate: new Date(`${day}T00:00:00Z`), durationSeconds: ns, note: `${NOTE}, already on the balance`, submittedAt: now, reviewedAt: now, reviewedById: actor.id, postedAt: now },
      });
      await placeLeave(entry.id);
      const placedOn = (await db.workSegment.findFirst({ where: { leaveRequestId: entry.id }, select: { timesheetId: true } }))?.timesheetId;
      if (placedOn) {
        await writeAuditLog({ tenantId: T, actorId: actor.id, action: "PAYROLL_LEAVE_ADDED", entityType: "TIMESHEET", entityId: placedOn, changes: { after: { leaveRequestId: entry.id, leaveTypeId: lt, date: day, hours: ns / 3600 }, reason: `${NOTE}: already on the balance` } });
        await noteTimecardChange({ timesheetId: placedOn, day, actorId: actor.id, change: `Added ${hoursLabel(ns / 3600)} ${NAME[lt]}`, note: `${NOTE}, already on the balance` });
      } else console.log(`         (no timecard placed for ${entry.id}: check)`);
    }
  }
  console.log({ apply: APPLY, ...counts, chargeHours: h(hours.A), addHours: h(hours.B) });
}
main().then(() => process.exit(0));
