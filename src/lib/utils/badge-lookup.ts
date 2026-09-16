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
 * badges and roughly 40% of all time clock scans. Those employees' timecards
 * were simply missing the punches.
 *
 * Matching on either column closes that, and the barcode column is kept
 * current by the Oracle sync service.
 */
export const KIOSK_EMPLOYEE_SELECT = {
  ruleSet: true,
  site: true,
  shift: { select: { startTime: true, endTime: true, workDays: true } },
} satisfies Prisma.EmployeeInclude;

/** Full employee record for the punch pipeline, matched on either badge form. */
export async function findEmployeeByBadge(code: string) {
  return db.employee.findFirst({
    where: { OR: [{ wmsId: code }, { barcode: code }] },
    include: KIOSK_EMPLOYEE_SELECT,
  });
}

/** Minimal lookup for recording a scan — no rule set, shift or site needed. */
export async function findEmployeeIdentityByBadge(code: string) {
  return db.employee.findFirst({
    where: { OR: [{ wmsId: code }, { barcode: code }] },
    select: {
      id: true,
      tenantId: true,
      site: { select: { timezone: true } },
      user: { select: { name: true } },
    },
  });
}
