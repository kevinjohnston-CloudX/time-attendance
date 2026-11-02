import { db } from "@/lib/db";

/**
 * The sites a person is held to, set on their employee record (Site access);
 * null when they reach every site, which no rows means. System and super
 * admins are never held to sites, as on Live Attendance (on-site.service.ts).
 *
 * <p>Read by the rows rather than the built-in role, so a custom role made
 * from Payroll Admin (Payroll Admin NL), which leaves the built-in role at
 * Employee, is held to its sites as Payroll Admin is.
 *
 * <p>Its own module, with the database alone, so jobs that run without a
 * signed-in person (scheduled reports) can read it.
 */
export async function siteLimit(ctx: { employeeId: string; role: string }): Promise<string[] | null> {
  if (ctx.role === "SYSTEM_ADMIN" || ctx.role === "SUPER_ADMIN" || !ctx.employeeId) return null;
  const rows = await db.hrSiteAccess.findMany({ where: { employeeId: ctx.employeeId }, select: { siteId: true } });
  return rows.length > 0 ? rows.map((r) => r.siteId) : null;
}
