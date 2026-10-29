import type { db } from "@/lib/db";

type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** One part of a leave entry, taken from one balance. */
export type LeavePiece = { leaveTypeId: string; seconds: number };

/**
 * Splits leave across the balances the person's policy takes it from first.
 *
 * <p>A policy can list other leave types to use before its own, in order:
 * NovaTime's advanced secondary pay codes. PTO120 and PTO160 take PTO from
 * PTO Carry Over first, so 5 hours of PTO with 1.5 hours of carry over left
 * comes off as 1.5 PTO Carry Over and 3.5 PTO. HR has split these by hand
 * (Yngris Ortiz Vargas, 1.98 and 6.02 on 10/16). Each earlier balance gives
 * what it has, to the hundredth of an hour, and the policy's own leave type
 * takes the rest; a day at a time, so carry over runs out across a week of
 * entries the same way.
 *
 * <p>Read from the balances as they stand: leave entered on a timecard comes
 * off as it is entered, so an entry earlier the same day has already been
 * taken. With no such policy, or nothing left in the earlier balances, the
 * leave stays one piece of its own type.
 */
export async function useFirstPieces(
  tx: TxClient,
  employeeId: string,
  leaveTypeId: string,
  date: Date,
  seconds: number,
): Promise<{ pieces: LeavePiece[]; policyName: string | null }> {
  const whole = { pieces: [{ leaveTypeId, seconds }], policyName: null };
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { payCategoryId: true } });
  if (!employee.payCategoryId) return whole;
  const link = await tx.payCategoryPtoPolicy.findFirst({
    where: {
      payCategoryId: employee.payCategoryId,
      ptoPolicy: { isActive: true, leaveTypeId, NOT: { useFirstLeaveTypeIds: { isEmpty: true } } },
    },
    select: { ptoPolicy: { select: { name: true, useFirstLeaveTypeIds: true } } },
  });
  const order = (link?.ptoPolicy.useFirstLeaveTypeIds ?? []).filter((t) => t !== leaveTypeId);
  if (order.length === 0) return whole;

  const balances = await tx.leaveBalance.findMany({
    where: { employeeId, accrualYear: date.getUTCFullYear(), leaveTypeId: { in: order } },
    select: { leaveTypeId: true, balanceSeconds: true },
  });
  const pieces: LeavePiece[] = [];
  let left = seconds;
  for (const t of order) {
    if (left === 0) break;
    const have = balances.find((b) => b.leaveTypeId === t)?.balanceSeconds ?? 0;
    // Whole hundredths of an hour (36 seconds), so each piece reads as NovaTime writes it.
    const take = Math.min(left, Math.max(0, Math.floor(have / 36) * 36));
    if (take > 0) {
      pieces.push({ leaveTypeId: t, seconds: take });
      left -= take;
    }
  }
  if (left > 0) pieces.push({ leaveTypeId, seconds: left });
  return { pieces, policyName: link!.ptoPolicy.name };
}

/**
 * The note each piece of a split carries, so the timecard says why:
 * "5.00 h split by PTO120: 1.50 PTO Carry Over + 3.50 PTO".
 */
export function splitNote(
  note: string | null | undefined,
  all: LeavePiece[],
  names: Map<string, string>,
  policyName: string | null,
): string | null {
  if (all.length < 2) return note ?? null;
  const total = (all.reduce((a, p) => a + p.seconds, 0) / 3600).toFixed(2);
  const split = all.map((p) => `${(p.seconds / 3600).toFixed(2)} ${names.get(p.leaveTypeId) ?? "leave"}`).join(" + ");
  const why = `${total} h split by ${policyName ?? "the leave policy"}: ${split}`;
  return note ? `${note} (${why})` : why;
}
