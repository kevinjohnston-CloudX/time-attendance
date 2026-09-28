import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkPermission } from "./check-permission";
import type { Permission } from "./permissions";

/**
 * Whose records an action may touch, for actions that take an id.
 *
 * <p>Always the caller's own company. Beyond that, payroll, HR and system
 * admins (the roles the supervisor screens already treat as company wide),
 * or anybody holding one of the action's company-wide permissions, reach
 * everyone in the company; a supervisor reaches their direct reports only,
 * the same team the supervisor screens list.
 *
 * <p>An id outside the scope answers "not found", never "forbidden", so a
 * guessed id says nothing about whether it exists.
 */

type Ctx = { employeeId: string; tenantId: string | null; role: string };

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
  return { ...company, supervisorId: ctx.employeeId || "__no_supervisor__" };
}

/** The employee, if the caller may act on them. */
export async function assertEmployeeInScope(ctx: Ctx, employeeId: string, companyWide: Wide): Promise<void> {
  const found = await db.employee.findFirst({
    where: { id: employeeId, ...(await employeeScope(ctx, companyWide)) },
    select: { id: true },
  });
  if (!found) throw new NotFoundError("Employee not found");
}

/** The timesheet's employee and status, if the caller may act on it. */
export async function timesheetInScope(ctx: Ctx, timesheetId: string, companyWide: Wide) {
  const ts = await db.timesheet.findFirst({
    where: { id: timesheetId, employee: await employeeScope(ctx, companyWide) },
    select: { id: true, employeeId: true, status: true },
  });
  if (!ts) throw new NotFoundError("Timesheet not found");
  return ts;
}

/** The punch's employee and timesheet, if the caller may act on it. */
export async function punchInScope(ctx: Ctx, punchId: string, companyWide: Wide) {
  const punch = await db.punch.findFirst({
    where: { id: punchId, employee: await employeeScope(ctx, companyWide) },
    select: { id: true, employeeId: true, timesheetId: true },
  });
  if (!punch) throw new NotFoundError("Punch not found");
  return punch;
}

/** Timesheets payroll has approved or locked are not edited by anyone. */
export function assertEditable(status: string): void {
  if (status === "LOCKED" || status === "PAYROLL_APPROVED") {
    throw new Error("Cannot modify a locked or approved timesheet.");
  }
}
