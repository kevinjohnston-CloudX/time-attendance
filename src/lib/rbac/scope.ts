import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkPermission } from "./check-permission";
import { getSubordinateIds } from "@/lib/get-subordinate-ids";
import { TIMECARD_EDITORS_COMPANY, type Permission } from "./permissions";
import { employeeRank } from "./identity";
import { assertActiveForChange } from "@/lib/inactive-timecards";

/**
 * Whose records an action may touch, for actions that take an id.
 *
 * <p>Always the caller's own company. Beyond that, payroll, HR and system
 * admins (the roles the supervisor screens already treat as company wide),
 * or anybody holding one of the action's company-wide permissions, reach
 * everyone in the company; a supervisor reaches the people who report to
 * them at any depth (getSubordinateIds), the same team the supervisor
 * screens list, and never themselves.
 *
 * <p>An id outside the scope answers "not found", never "forbidden", so a
 * guessed id says nothing about whether it exists.
 */

type Ctx = { employeeId: string; tenantId: string | null; role: string; viewAsRank?: number };

const COMPANY_WIDE_ROLES = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"];
type Wide = Permission | Permission[];

export class NotFoundError extends Error {
  constructor(what = "Not found") {
    super(what);
    this.name = "NotFoundError";
  }
}

export async function reachesCompany(ctx: Ctx, companyWide: Wide): Promise<boolean> {
  if (COMPANY_WIDE_ROLES.includes(ctx.role)) return true;
  for (const p of Array.isArray(companyWide) ? companyWide : [companyWide]) if (await checkPermission(p)) return true;
  return false;
}

/**
 * The sites a Payroll or HR Admin is held to, set on their employee record
 * (Site access); null when they reach every site, which no rows means. Other
 * roles are never held to sites here.
 */
export async function siteLimit(ctx: { employeeId: string; role: string }): Promise<string[] | null> {
  if ((ctx.role !== "PAYROLL_ADMIN" && ctx.role !== "HR_ADMIN") || !ctx.employeeId) return null;
  const rows = await db.hrSiteAccess.findMany({ where: { employeeId: ctx.employeeId }, select: { siteId: true } });
  return rows.length > 0 ? rows.map((r) => r.siteId) : null;
}

/**
 * An employee record the caller may open or change on the Employees screens:
 * in their company and, for a Payroll or HR Admin held to some sites, at one
 * of those sites, as the Employees list offers them. Anyone else's answers
 * "not found", as an unknown id does. The record page opened anyone's by id
 * (date of birth, address, pay) while the list hid them.
 */
export async function assertRecordInReach(ctx: { employeeId: string; tenantId: string | null; role: string }, employeeId: string): Promise<void> {
  const sites = await siteLimit(ctx);
  const found = await db.employee.findFirst({
    where: { id: employeeId, tenantId: ctx.tenantId ?? "__no_company__", ...(sites ? { siteId: { in: sites } } : {}) },
    select: { id: true },
  });
  if (!found) throw new NotFoundError("Employee not found");
}

/**
 * A leave balance the caller may change: someone in their company and at
 * their sites (as their record is), not ranked above them, and a leave type of
 * this company. Their own only for HR and System Admins; a Payroll Admin could
 * add hours to their own balance here, or to a senior's.
 */
export async function assertBalanceChangeAllowed(
  actor: { employeeId: string; tenantId: string | null; role: string },
  employeeId: string,
  leaveTypeId: string,
) {
  await assertRecordInReach(actor, employeeId);
  if (employeeId === actor.employeeId) {
    if (!["HR_ADMIN", "SYSTEM_ADMIN", "SUPER_ADMIN"].includes(actor.role)) throw new Error("You can't change your own leave balance");
  } else {
    await assertNotSenior(actor, employeeId);
  }
  const leaveType = await db.leaveType.findFirst({ where: { id: leaveTypeId, tenantId: actor.tenantId ?? "__no_company__" }, select: { id: true } });
  if (!leaveType) throw new Error("Leave type not found");
}

/**
 * Timecard access a site limit narrows: a Payroll Admin held to some sites
 * sees and changes the timecards of people at those sites only, and an id
 * from anywhere else answers "not found", as the list never offers it. The
 * screens that check punch editing alone (exceptions, missed punches) list
 * every site still, so their actions are not narrowed either.
 */
const SITE_LIMITED: Permission[] = ["TIMECARD_VIEW_ANY", "TIMECARD_EDIT_ANY"];

export async function employeeScope(ctx: Ctx, companyWide: Wide): Promise<Prisma.EmployeeWhereInput> {
  const company: Prisma.EmployeeWhereInput = { tenantId: ctx.tenantId ?? "__no_company__" };
  if (await reachesCompany(ctx, companyWide)) {
    const wide = Array.isArray(companyWide) ? companyWide : [companyWide];
    const sites = wide.some((p) => SITE_LIMITED.includes(p)) ? await siteLimit(ctx) : null;
    return sites ? { ...company, siteId: { in: sites } } : company;
  }
  const team = ctx.employeeId ? await getSubordinateIds(ctx.employeeId, ctx.tenantId) : [];
  return { ...company, id: { in: team } };
}

/**
 * Company-wide permissions that reach everyone's hours whatever their rank:
 * editing every timecard, and entering or approving everyone's leave. HR
 * coordinators holding them were refused a senior's timecard and PTO ("You
 * can't change the records of someone ranked above you"), which their job
 * needs. A senior's profile, role and access keep the rank rule.
 */
export const RANK_EXEMPT: Permission[] = [...TIMECARD_EDITORS_COMPANY, "LEAVE_REQUEST_ANY", "LEAVE_APPROVE_ANY"];

/**
 * Nobody changes the records of someone ranked above them (a Payroll Admin
 * cannot touch an HR Admin's profile). Peers and juniors are fine; seeing a
 * senior's records is not affected. `companyWide` is the action's own
 * company-wide permission: holding one of the {@link RANK_EXEMPT} ones lifts
 * the rule for that action.
 */
export async function assertNotSenior(ctx: Ctx, targetEmployeeId: string, companyWide?: Wide): Promise<void> {
  if (ctx.role === "SUPER_ADMIN" || !ctx.tenantId) return;
  const exempt = (Array.isArray(companyWide) ? companyWide : companyWide ? [companyWide] : []).filter((p) => RANK_EXEMPT.includes(p));
  for (const p of exempt) if (await checkPermission(p)) return;
  const [mine, theirs] = await Promise.all([
    ctx.viewAsRank !== undefined
      ? Promise.resolve(ctx.viewAsRank)
      : ctx.employeeId ? employeeRank(ctx.employeeId, ctx.tenantId) : Promise.resolve(null),
    employeeRank(targetEmployeeId, ctx.tenantId),
  ]);
  if (theirs !== null && (mine ?? 0) < theirs) {
    throw new Error("You can't change the records of someone ranked above you");
  }
}

type ScopeOptions = {
  forChange?: boolean;
  /**
   * For a change that may still be made to someone who is inactive: payroll
   * locking or unlocking their timecard. Everything else is refused.
   */
  allowInactive?: boolean;
};

export { INACTIVE_TIMECARD_ERROR, assertActiveForChange } from "@/lib/inactive-timecards";

/** The employee, if the caller may act on them. */
export async function assertEmployeeInScope(ctx: Ctx, employeeId: string, companyWide: Wide, { forChange = true, allowInactive = false }: ScopeOptions = {}): Promise<void> {
  const found = await db.employee.findFirst({
    where: { AND: [{ id: employeeId }, await employeeScope(ctx, companyWide)] },
    select: { id: true, isActive: true },
  });
  if (!found) throw new NotFoundError("Employee not found");
  if (forChange && !allowInactive) assertActiveForChange(found.isActive);
  if (forChange) await assertNotSenior(ctx, employeeId, companyWide);
}

/** The timesheet's employee and status, if the caller may act on it. */
export async function timesheetInScope(ctx: Ctx, timesheetId: string, companyWide: Wide, { forChange = true, allowInactive = false }: ScopeOptions = {}) {
  const found = await db.timesheet.findFirst({
    where: { id: timesheetId, employee: await employeeScope(ctx, companyWide) },
    select: { id: true, employeeId: true, status: true, employee: { select: { isActive: true } } },
  });
  if (!found) throw new NotFoundError("Timesheet not found");
  const { employee, ...ts } = found;
  if (forChange && !allowInactive) assertActiveForChange(employee.isActive);
  if (forChange) await assertNotSenior(ctx, ts.employeeId, companyWide);
  return ts;
}

/**
 * A timecard the caller may change right now: in their scope, not their own,
 * not ranked above them, and not locked.
 */
export async function editableTimesheetInScope(ctx: Ctx, timesheetId: string) {
  const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
  if (sheet.employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");
  assertEditable(sheet.status);
  return sheet;
}

/** The punch's employee and timesheet, if the caller may act on it. */
export async function punchInScope(ctx: Ctx, punchId: string, companyWide: Wide) {
  const found = await db.punch.findFirst({
    where: { id: punchId, employee: await employeeScope(ctx, companyWide) },
    select: { id: true, employeeId: true, timesheetId: true, employee: { select: { isActive: true } } },
  });
  if (!found) throw new NotFoundError("Punch not found");
  const { employee, ...punch } = found;
  assertActiveForChange(employee.isActive);
  await assertNotSenior(ctx, punch.employeeId, companyWide);
  return punch;
}

/** Timesheets payroll has approved or locked are not edited by anyone. */
export function assertEditable(status: string): void {
  if (status === "LOCKED" || status === "PAYROLL_APPROVED") {
    throw new Error("Cannot modify a locked or approved timesheet.");
  }
}
