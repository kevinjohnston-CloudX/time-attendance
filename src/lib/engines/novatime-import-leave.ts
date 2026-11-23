import type { Prisma } from "@prisma/client";
import type { db } from "@/lib/db";
import type { TxClient } from "@/types/prisma";

/** The note on the leave loaded from NovaTime's history (scripts/backfill-leave-requests.cjs). */
export const NOVATIME_IMPORT_NOTE = "novatime-import";

type Client = TxClient | typeof db;

/** A hundredth of an hour, in seconds. */
const HUNDREDTH = 36;

/**
 * Before a request of ours is taken off the balance: the leave NovaTime had
 * already booked for the same person, leave type and day steps aside for it.
 *
 * <p>NovaTime's history was loaded twice over. Its usage went onto the ledger
 * (a USAGE row, linked to no request, that the balance already counts), and
 * each day of it became a posted request of its own, which shows on no
 * timecard. Leave booked ahead in NovaTime looked missing here, so it was
 * entered again: a punch under a PTO code, Add time, an approved request. That
 * second entry was charged as well, and the day sat in Booked twice (David
 * Hernandez, 9/14; Jailine Brito Lopez, three days charged twice).
 *
 * <p>So the imported request is cancelled and NovaTime's charge for it given
 * back, on the imported request, and ours is charged as anything else is. The
 * give-back sits on the request it belongs to, so ours keeps its own debit and
 * its own reversal: removing the entry later puts its hours back, and nothing
 * of NovaTime's is left behind.
 *
 * <p>Only what NovaTime's usage for that day shows is given back, never more
 * than the imported request: an import with no usage row behind it gives back
 * nothing. An imported request a salary line already holds (relinkCreditLeave)
 * is on the timecard, and is left alone.
 *
 * @returns the seconds given back
 */
export async function replaceNovaTimeImports(
  client: Client,
  request: {
    id: string;
    employeeId: string;
    leaveTypeId: string;
    startDate: Date;
    endDate: Date;
    note?: string | null;
    selectedDays?: Prisma.JsonValue | null;
  },
  actorId?: string | null,
): Promise<number> {
  if (request.note === NOVATIME_IMPORT_NOTE) return 0;

  const found = await client.leaveRequest.findMany({
    where: {
      employeeId: request.employeeId,
      leaveTypeId: request.leaveTypeId,
      status: "POSTED",
      note: NOVATIME_IMPORT_NOTE,
      id: { not: request.id },
      startDate: { gte: request.startDate, lte: request.endDate },
      segments: { none: {} },
    },
    select: { id: true, startDate: true, durationSeconds: true },
    orderBy: { startDate: "asc" },
  });
  if (found.length === 0) return 0;

  // A request over several days covers the days it picked, not every day between.
  const picked = pickedDays(request.selectedDays);
  const imports = picked ? found.filter((i) => picked.has(i.startDate.toISOString().slice(0, 10))) : found;

  let total = 0;
  for (const imp of imports) {
    // Cancelled only if still posted, so two entries for one day give it back once.
    const { count } = await client.leaveRequest.updateMany({
      where: { id: imp.id, status: "POSTED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), reviewNote: `Replaced by ${request.id}` },
    });
    if (count === 0) continue;

    const charged = await client.leaveAccrualLedger.aggregate({
      where: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        action: "USAGE",
        leaveRequestId: null,
        payPeriodEnd: imp.startDate,
      },
      _sum: { deltaSeconds: true },
    });
    // Less what an earlier replacement already gave back for the day (two imports of one day).
    const given = await client.leaveAccrualLedger.aggregate({
      where: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        action: "ADJUSTMENT",
        leaveRequest: { note: NOVATIME_IMPORT_NOTE, startDate: imp.startDate },
      },
      _sum: { deltaSeconds: true },
    });
    // Up to a hundredth over the import: its hours and NovaTime's usage were
    // rounded apart (1.28 h imported for 1.29 h used left Jenny Blanco at -0.01).
    const giveBack = Math.min(imp.durationSeconds + HUNDREDTH, -(charged._sum.deltaSeconds ?? 0) - (given._sum.deltaSeconds ?? 0));
    if (giveBack <= 0) continue;

    const key = { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, accrualYear: imp.startDate.getUTCFullYear() };
    const balance = await client.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_accrualYear: key },
      create: key,
      update: {},
    });
    const newBalance = balance.balanceSeconds + giveBack;
    await client.leaveBalance.update({
      where: { id: balance.id },
      data: { balanceSeconds: newBalance, usedSeconds: { decrement: giveBack } },
    });
    await client.leaveAccrualLedger.create({
      data: {
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        action: "ADJUSTMENT",
        deltaSeconds: giveBack,
        balanceAfterSeconds: newBalance,
        leaveRequestId: imp.id,
        createdById: actorId ?? null,
        note: "Given back: NovaTime's leave for this day, entered again here",
      },
    });
    total += giveBack;
  }
  return total;
}

/** The YYYY-MM-DD days a request picked, or null when it picked none (every day in its range). */
function pickedDays(selectedDays: Prisma.JsonValue | null | undefined): Set<string> | null {
  if (!Array.isArray(selectedDays) || selectedDays.length === 0) return null;
  const days = new Set<string>();
  for (const d of selectedDays) {
    if (d && typeof d === "object" && !Array.isArray(d) && typeof d.date === "string") days.add(d.date.slice(0, 10));
  }
  return days.size > 0 ? days : null;
}
