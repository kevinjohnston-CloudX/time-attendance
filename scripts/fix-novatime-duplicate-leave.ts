/**
 * Leave NovaTime had booked (a posted "novatime-import" request, charged by an
 * unlinked USAGE row) that was entered again here for the same person, leave
 * type and day. The imported request is cancelled, so the day is in Booked
 * once. Where ours was charged as well, NovaTime's charge is given back on the
 * imported request, as replaceNovaTimeImports now does when it happens.
 *
 *   TZ=UTC npx tsx scripts/fix-novatime-duplicate-leave.ts           dry run
 *   TZ=UTC npx tsx scripts/fix-novatime-duplicate-leave.ts --apply   cancel imports ours did not charge
 *   ... --apply --give-back                                          and give back where ours charged too
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const GIVE_BACK = process.argv.includes("--give-back");

async function main() {
  const { db } = await import("@/lib/db");
  const { replaceNovaTimeImports, NOVATIME_IMPORT_NOTE } = await import("@/lib/engines/novatime-import-leave");
  const h = (s: number) => (s / 3600).toFixed(2);

  const imports = await db.leaveRequest.findMany({
    where: { note: NOVATIME_IMPORT_NOTE, status: "POSTED", segments: { none: {} } },
    select: { id: true, employeeId: true, leaveTypeId: true, startDate: true, durationSeconds: true },
  });
  const key = (r: { employeeId: string; leaveTypeId: string; startDate: Date }) => `${r.employeeId}|${r.leaveTypeId}|${r.startDate.toISOString().slice(0, 10)}`;
  const importByKey = new Map<string, typeof imports>();
  for (const i of imports) importByKey.set(key(i), [...(importByKey.get(key(i)) ?? []), i]);

  const ours = await db.leaveRequest.findMany({
    where: { status: { in: ["POSTED", "APPROVED"] }, OR: [{ note: null }, { note: { not: NOVATIME_IMPORT_NOTE } }], startDate: { lt: new Date("2027-01-01") } },
    select: {
      id: true, employeeId: true, leaveTypeId: true, startDate: true, endDate: true, note: true, selectedDays: true, reviewedById: true, durationSeconds: true,
      employee: { select: { user: { select: { name: true } } } }, leaveType: { select: { name: true } },
      ledgerEntries: { select: { action: true, deltaSeconds: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const done = new Set<string>();
  let cancelled = 0, givenBack = 0, held = 0;
  for (const o of ours) {
    const imps = (importByKey.get(key(o)) ?? []).filter((i) => !done.has(i.id));
    if (imps.length === 0) continue;
    const debited = -o.ledgerEntries.filter((e) => ["USAGE", "TIMECARD_DEDUCTION", "ADJUSTMENT"].includes(e.action)).reduce((a, e) => a + e.deltaSeconds, 0);
    const label = `${o.employee.user.name.padEnd(26)} ${o.startDate.toISOString().slice(0, 10)} ${o.leaveType.name.padEnd(14)} ours ${h(o.durationSeconds)} charged ${h(debited)} | import ${imps.map((i) => h(i.durationSeconds)).join("+")}`;
    for (const i of imps) done.add(i.id);

    if (debited > 0) {
      // Charged here and by NovaTime: give NovaTime's back.
      if (APPLY && GIVE_BACK) {
        const back = await db.$transaction((tx) => replaceNovaTimeImports(tx, o, o.reviewedById));
        givenBack += back;
        console.log("GIVE BACK", label, "->", h(back));
      } else { held++; console.log("CHARGED TWICE", label); }
    } else {
      // Ours took nothing off (or gave it back): only the duplicate in Booked goes.
      if (APPLY) {
        await db.leaveRequest.updateMany({ where: { id: { in: imps.map((i) => i.id) }, status: "POSTED" }, data: { status: "CANCELLED", cancelledAt: new Date(), reviewNote: `Replaced by ${o.id}` } });
      }
      cancelled += imps.length;
      console.log("CANCEL IMPORT", label);
    }
  }
  console.log({ apply: APPLY, giveBack: GIVE_BACK, importsCancelled: cancelled, chargedTwiceHeld: held, hoursGivenBack: h(givenBack) });
}
main().then(() => process.exit(0));
