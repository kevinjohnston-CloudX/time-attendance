import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkPermission } from "./check-permission";
import { getSubordinateIds } from "@/lib/get-subordinate-ids";
import { TIMECARD_EDITORS_COMPANY, type Permission } from "./permissions";
import { employeeRank } from "./identity";

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

export async function employeeScope(ctx: Ctx, companyWide: Wide): Promise<Prisma.EmployeeWhereInput> {
  const company: Prisma.EmployeeWhereInput = { tenantId: ctx.tenantId ?? "__no_company__" };
  if (await reachesCompany(ctx, companyWide)) return company;
  const team = ctx.employeeId ? await getSubordinateIds(ctx.employeeId, ctx.tenantId) : [];
  return { ...company, id: { in: team } };
}

/**
 * Nobody changes the records of someone ranked above them (a Payroll Admin
 * cannot touch an HR Admin's timecard or leave). Peers and juniors are fine;
 * seeing a senior's records is not affected.
 */
export async function assertNotSenior(ctx: Ctx, targetEmployeeId: string): Promise<void> {
  if (ctx.role === "SUPER_ADMIN" || !ctx.tenantId) return;
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

type ScopeOptions = { forChange?: boolean };

/** The employee, if the caller may act on them. */
export async function assertEmployeeInScope(ctx: Ctx, employeeId: string, companyWide: Wide, { forChange = true }: ScopeOptions = {}): Promise<void> {
  const found = await db.employee.findFirst({
    where: { AND: [{ id: employeeId }, await employeeScope(ctx, companyWide)] },
    select: { id: true },
  });
  if (!found) throw new NotFoundError("Employee not found");
  if (forChange) await assertNotSenior(ctx, employeeId);
}

/** The timesheet's employee and status, if the caller may act on it. */
export async function timesheetInScope(ctx: Ctx, timesheetId: string, companyWide: Wide, { forChange = true }: ScopeOptions = {}) {
  const ts = await db.timesheet.findFirst({
    where: { id: timesheetId, employee: await employeeScope(ctx, companyWide) },
    select: { id: true, employeeId: true, status: true },
  });
  if (!ts) throw new NotFoundError("Timesheet not found");
  if (forChange) await assertNotSenior(ctx, ts.employeeId);
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
  const punch = await db.punch.findFirst({
    where: { id: punchId, employee: await employeeScope(ctx, companyWide) },
    select: { id: true, employeeId: true, timesheetId: true },
  });
  if (!punch) throw new NotFoundError("Punch not found");
  await assertNotSenior(ctx, punch.employeeId);
  return punch;
}

/** Timesheets payroll has approved or locked are not edited by anyone. */
export function assertEditable(status: string): void {
  if (status === "LOCKED" || status === "PAYROLL_APPROVED") {
    throw new Error("Cannot modify a locked or approved timesheet.");
  }
}
