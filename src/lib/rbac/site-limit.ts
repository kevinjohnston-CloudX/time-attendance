import { db } from "@/lib/db";

/**
 * The sites a Payroll or HR Admin is held to, set on their employee record
 * (Site access); null when they reach every site, which no rows means. Other
 * roles are never held to sites here.
 *
 * <p>Its own module, with the database alone, so jobs that run without a
 * signed-in person (scheduled reports) can read it.
 */
export async function siteLimit(ctx: { employeeId: string; role: string }): Promise<string[] | null> {
  if ((ctx.role !== "PAYROLL_ADMIN" && ctx.role !== "HR_ADMIN") || !ctx.employeeId) return null;
  const rows = await db.hrSiteAccess.findMany({ where: { employeeId: ctx.employeeId }, select: { siteId: true } });
  return rows.length > 0 ? rows.map((r) => r.siteId) : null;
}
