import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Finds the employee a kiosk scan belongs to.
 *
 * <p><b>Why this is not just a wmsId lookup.</b> Two badge formats are in
 * circulation: a 6-digit employee number, and a 10-digit barcode. The legacy
 * API has always translated the second into the first before doing anything
 * else —
 *
 * <pre>
 *   select u.empid from framewrk.users u
 *   join wmsusers wu on wu.userid = u.usersid
 *   where wu.barcode = :barcode
 * </pre>
 *
 * — and this system did not. Every 10-digit badge therefore matched nothing
 * and its punches were never recorded, which on 2026-09-15 was 247 distinct
 * badges and roughly 40% of all time clock scans.
 *
 * <p><b>And why the leading zeros matter.</b> The tablets zero-pad the barcode
 * to ten characters; Oracle stores it unpadded. So `0851064226` on the badge is
 * `851064226` in `wmsusers`. Eleven of the failing badges differed by nothing
 * but that padding, so a scan is matched against both its literal value and its
 * zero-stripped form. The stored value stays exactly as Oracle has it — the
 * normalising happens here, at the point of comparison, rather than by
 * rewriting what the source system said.
 */

/** A scanned code as itself, and with any leading zeros removed. */
function badgeCandidates(code: string): string[] {
  const trimmed = code.trim();
  const stripped = trimmed.replace(/^0+/, "");
  // A code that is all zeros strips to nothing; keep the original in that case.
  return stripped && stripped !== trimmed ? [trimmed, stripped] : [trimmed];
}

/**
 * wmsId is matched literally — employee numbers are not zero-padded, so
 * stripping there would let "0123456" match employee 123456, which is a
 * different person's timecard.
 */
export function badgeWhere(code: string): Prisma.EmployeeWhereInput {
  const candidates = badgeCandidates(code);
  return { OR: [{ wmsId: code.trim() }, { barcode: { in: candidates } }] };
}

export const KIOSK_EMPLOYEE_SELECT = {
  ruleSet: true,
  site: true,
  shift: { select: { startTime: true, endTime: true, workDays: true } },
} satisfies Prisma.EmployeeInclude;

/** Full employee record for the punch pipeline, matched on either badge form. */
export async function findEmployeeByBadge(code: string) {
  return db.employee.findFirst({
    where: badgeWhere(code),
    include: KIOSK_EMPLOYEE_SELECT,
  });
}

/** Minimal lookup for recording a scan — no rule set, shift or site needed. */
export async function findEmployeeIdentityByBadge(code: string) {
  return db.employee.findFirst({
    where: badgeWhere(code),
    select: {
      id: true,
      tenantId: true,
      site: { select: { timezone: true } },
      user: { select: { name: true } },
    },
  });
}
