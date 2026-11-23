"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { createCorrectionPunch } from "@/lib/utils/punch-correction";
import { assertEditable, punchInScope, reachesCompany, timesheetInScope } from "@/lib/rbac/scope";
import { siteLimit } from "@/lib/rbac/site-limit";
import type { Permission } from "@/lib/rbac/permissions";
import { computeRoundedTime } from "@/lib/utils/date";
import {
  resolveExceptionSchema,
  addMissingPunchSchema,
  addAbsentDayPunchesSchema,
  type AddAbsentDayPunchesInput,
  correctAndResolveSchema,
  type ResolveExceptionInput,
  type AddMissingPunchInput,
  type CorrectAndResolveInput,
} from "@/lib/validators/supervisor.schema";
import { z } from "zod";
import { ExceptionType } from "@prisma/client";
import { getSubordinateIds } from "@/lib/get-subordinate-ids";
import { dayRange, readOpenExceptions } from "@/lib/exceptions/read-open-exceptions";
import type { PunchState, PunchType } from "@prisma/client";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { ownCompany } from "@/lib/rbac/company";
import { assertSupervisorEditsOn, editsNeedApproval, resolveEditItem, sendEditsForApproval, timecardForEdits } from "@/lib/timecards/supervisor-edits";
import type { EditItemInput } from "@/lib/timecards/supervisor-edit-rules";
import { withoutVisitors } from "@/lib/utils/client-badge";

// Payroll, HR and the admins see the whole company, as does a custom role
// with the company-wide permission (reachesCompany): Payroll Admin NL, made
// from Payroll Admin, reaches what Payroll Admin does. A super admin only
// reaches these with a company: their own, as their employee record there
// (see auth.ts).

/** Narrows the employees a team screen reads: by person, by site, or neither. */
type TeamFilter = { id?: { in: string[] }; siteId?: { in: string[] } };

/**
 * Whose rows a team screen shows. Someone reaching the company (above) sees
 * everyone in it, or only the people at the sites on their record when Site
 * access names some: a Payroll Admin for Brampton saw Bergen's exceptions,
 * leave and punches here while Timecards and Employees held them to Brampton.
 * Anyone else sees the people under them. Null when that is nobody.
 */
async function teamFilter(
  ctx: { employeeId: string; role: string; tenantId: string | null },
  companyWide: Permission,
): Promise<TeamFilter | null> {
  if (await reachesCompany(ctx, companyWide)) {
    const sites = await siteLimit(ctx);
    return sites ? { siteId: { in: sites } } : {};
  }
  const ids = await getSubordinateIds(ctx.employeeId, ctx.tenantId);
  return ids.length > 0 ? { id: { in: ids } } : null;
}

/**
 * The employees whose leave the leave queues list, with the screen's site,
 * department and shift pickers, which only someone reaching the company is
 * offered. The picked site is added to the sites they are held to, never put
 * in its place, so picking another building finds nobody. Null when nobody.
 */
async function leaveEmployees(
  ctx: { employeeId: string; role: string; tenantId: string | null },
  picked: { siteId?: string; departmentId?: string; shiftId?: string },
): Promise<Prisma.EmployeeWhereInput | null> {
  const t = ownCompany(ctx.tenantId);
  const reach = await teamFilter(ctx, "LEAVE_APPROVE_ANY");
  if (!reach) return null;
  if (reach.id) return { id: reach.id, tenantId: t };
  return {
    tenantId: t,
    ...(picked.departmentId ? { departmentId: picked.departmentId } : {}),
    ...(picked.shiftId ? { shiftId: picked.shiftId } : {}),
    AND: [reach.siteId ? { siteId: reach.siteId } : {}, picked.siteId ? { siteId: picked.siteId } : {}],
  };
}

/** Pay periods are stored at UTC midnight, so one day is that whole UTC day. */

// ─── Exceptions ───────────────────────────────────────────────────────────────

/** All unresolved exceptions for the supervisor's team (or all if payroll+). */
/**
 * The open exceptions in the viewer's scope, for the exceptions screen.
 *
 * <p>Deliberately does not carry the timesheet's punches. It used to: every
 * exception arrived with its whole timesheet, employee, user, site, department
 * and pay period, plus every punch on that sheet. Because roughly three
 * exceptions share a timesheet, the same punches were serialised three times
 * over, and the page came to 25MB of HTML and 4.5 seconds for 2,619 open
 * exceptions. Punches are only ever read once somebody opens the action panel
 * on one card, so {@link getExceptionPunches} fetches them then.
 *
 * <p>`hasPunches` is what the collapsed panel needs: it is the only thing the
 * card knows about punches before it is opened, and it decides whether
 * "Correct a Punch" is available.
 */
export const getTeamExceptions = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { siteId, departmentId, shiftId, exceptionType, payPeriodStart } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
      exceptionType: z.nativeEnum(ExceptionType).optional(),
      // A day (YYYY-MM-DD): every rule set's period that starts on it, since
      // one company runs a period per rule set over the same dates.
      payPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(input ?? {});

    const t = ownCompany(tenantId);
    const idFilter = await teamFilter({ employeeId, role, tenantId }, "TIMESHEET_APPROVE_ANY");
    if (!idFilter) return [];
    return readOpenExceptions({ t, idFilter, siteId, departmentId, shiftId, exceptionType, payPeriodStart });
  }
);

/**
 * How many of each exception type are open in the viewer's scope.
 *
 * <p>Deliberately ignores the exception type filter while honouring every
 * other one. The type control has to be able to say what picking a different
 * type would get you, and a census taken after the type filter has run can
 * only ever say "the one you already picked, and zero of everything else".
 *
 * <p>One grouped count in the database rather than a second pass over the
 * rows, so the numbers stay right on a screen that pages its list.
 */
export const getExceptionTypeCounts = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { siteId, departmentId, shiftId, payPeriodStart } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
      payPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(input ?? {});

    const idFilter = await teamFilter({ employeeId, role, tenantId }, "TIMESHEET_APPROVE_ANY");
    if (!idFilter) return {};

    const grouped = await db.exception.groupBy({
      by: ["exceptionType"],
      where: {
        resolvedAt: null,
        timesheet: {
          ...(payPeriodStart ? { payPeriod: { startDate: dayRange(payPeriodStart) } } : {}),
          employee: {
            tenantId: ownCompany(tenantId),
            // In AND, so the picked site below narrows their sites, not replaces them.
            AND: [idFilter],
            ...(siteId ? { siteId } : {}),
            ...(departmentId ? { departmentId } : {}),
            ...(shiftId ? { shiftId } : {}),
          },
        },
      },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.exceptionType] = g._count._all;
    return counts;
  }
);

/**
 * The punches on one timesheet, for the action panel that is being opened.
 *
 * <p>Scoped the same way the exceptions list is: a supervisor reaches their
 * own team's sheets and nobody else's, and payroll reaches their tenant. The
 * scope is in the `where` rather than checked after the read, and a sheet
 * outside it comes back as though it does not exist.
 */
export const getExceptionPunches = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { timesheetId } = z.object({ timesheetId: z.string() }).parse(input);
    const idFilter = await teamFilter({ employeeId, role, tenantId }, "TIMESHEET_APPROVE_ANY");
    if (!idFilter) return null;

    const timesheet = await db.timesheet.findFirst({
      where: {
        id: timesheetId,
        employee: {
          tenantId: ownCompany(tenantId),
          ...idFilter,
        },
      },
      select: { id: true },
    });
    if (!timesheet) return null;

    return db.punch.findMany({
      where: { timesheetId, isApproved: true, correctedById: null },
      orderBy: { roundedTime: "asc" },
      select: { id: true, punchType: true, roundedTime: true },
    });
  }
);

export const resolveException = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async (ctx, input: ResolveExceptionInput) => {
    const { employeeId, tenantId } = ctx;
    const { exceptionId, resolution } = resolveExceptionSchema.parse(input);

    const exception = await db.exception.findUniqueOrThrow({
      where: { id: exceptionId },
    });
    // Only on a timesheet of someone the caller manages, and not their own.
    // Someone who no longer works here too (allowInactive): this only closes
    // the flag with a note and never touches punches, hours or pay, which
    // stay refused for them everywhere else. Without it, a leaver's open
    // absences could only be cleared by reactivating them.
    const sheet = await timesheetInScope(ctx, exception.timesheetId, "TIMESHEET_APPROVE_ANY", { allowInactive: true });
    if (sheet.employeeId === employeeId) throw new Error("You can't resolve your own exceptions");

    const updated = await db.exception.update({
      where: { id: exceptionId },
      data: {
        resolvedAt: new Date(),
        resolvedById: employeeId,
        resolution,
      },
    });

    await writeAuditLog({
      tenantId,
      actorId: employeeId,
      entityType: "TIMESHEET",
      entityId: exception.timesheetId,
      action: "EXCEPTION_RESOLVED",
      changes: { after: { exceptionType: exception.exceptionType, resolution } },
    });

    revalidatePath("/supervisor/exceptions");
    revalidatePath(`/payroll/pay-periods`);
    return updated;
  }
);

const STATE_AFTER: Record<string, PunchState> = {
  CLOCK_IN: "WORK", MEAL_START: "MEAL", MEAL_END: "WORK",
  CLOCK_OUT: "OUT", BREAK_START: "BREAK", BREAK_END: "WORK",
};

/**
 * Supervisor adds a missing punch directly, auto-resolving the exception. A
 * supervisor allowed only to fix missed punches (PUNCH_FIX_MISSED_TEAM) adds
 * the clock in or clock out a missed punch is short of, under the regular
 * hours pay code; correcting an existing punch (correctPunchAndResolve) stays
 * with Punches Write.
 */
export const addMissingPunchForEmployee = withRBAC(
  ["PUNCH_EDIT_TEAM", "PUNCH_FIX_MISSED_TEAM"],
  async (ctx, input: AddMissingPunchInput) => {
    const { employeeId: supervisorId, tenantId } = ctx;
    const { timesheetId, exceptionId, punchType, punchTime: punchTimeStr, reason } =
      addMissingPunchSchema.parse(input);
    const punchTime = new Date(punchTimeStr);
    // Only on a timesheet of someone the caller manages, not their own, and
    // not one payroll has approved or locked.
    const sheet = await timesheetInScope(ctx, timesheetId, "PUNCH_EDIT_ANY");
    if (sheet.employeeId === supervisorId) throw new Error("You can't change your own punches");
    assertEditable(sheet.status);
    if (await editsNeedApproval()) {
      if (punchType !== "CLOCK_IN" && punchType !== "CLOCK_OUT") throw new Error("You can add a clock in or a clock out. Ask HR or payroll for a meal or break punch.");
      return sendFromExceptions(ctx, sheet.employeeId, timesheetId, reason, [{ kind: "ADD_PUNCH", punchType, at: punchTimeStr }]);
    }

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: {
        employee: {
          include: {
            ruleSet: true,
            shift: { select: { startTime: true, endTime: true, workDays: true } },
            site: { select: { timezone: true } },
          },
        },
      },
    });

    const { ruleSet, shift } = timesheet.employee;
    const roundedTime = computeRoundedTime(punchTime, punchType, ruleSet, shift, personTimeZone(timesheet.employee, "UTC"));

    await db.$transaction(async (tx) => {
      await tx.punch.create({
        data: {
          employeeId: timesheet.employeeId,
          timesheetId,
          punchType: punchType as PunchType,
          punchTime,
          roundedTime,
          source: "MANUAL",
          stateBefore: "OUT",
          stateAfter: STATE_AFTER[punchType] ?? "OUT",
          isApproved: true,
          approvedById: supervisorId,
          approvedAt: new Date(),
          note: reason,
        },
      });
      // The exception must be this timesheet's.
      await tx.exception.updateMany({
        where: { id: exceptionId, timesheetId },
        data: { resolvedAt: new Date(), resolvedById: supervisorId, resolution: reason },
      });
      await writeAuditLog({
        tenantId,
        actorId: supervisorId,
        action: "PUNCH_ADDED",
        entityType: "PUNCH",
        entityId: timesheetId,
        changes: { after: { punchType, punchTime: punchTimeStr, reason } },
      });
    });

    await rebuildSegments(timesheetId, timesheet.employee.ruleSet);
    revalidatePath("/supervisor/exceptions");
    revalidatePath("/time/history");
    revalidatePath(`/time/timesheet/${timesheetId}`);
    return { pending: false };
  }
);

/**
 * A supervisor's change from the Exceptions page, sent to HR as one from the
 * timecard is (11/11): checked by the same rules, and nothing on the timecard,
 * the exception included, changes until HR approves it.
 */
async function sendFromExceptions(
  ctx: Parameters<typeof timesheetInScope>[0],
  employeeId: string,
  timesheetId: string,
  reason: string,
  inputs: EditItemInput[],
): Promise<{ pending: true }> {
  await assertSupervisorEditsOn(employeeId);
  const tc = await timecardForEdits(timesheetId);
  const items = inputs.map((i) => resolveEditItem(tc, i));
  await sendEditsForApproval({ tenantId: ctx.tenantId!, timesheetId, submittedById: ctx.employeeId!, reason, items, timeZone: tc.timeZone });
  revalidatePath("/supervisor/exceptions");
  revalidatePath("/payroll/timecards");
  return { pending: true };
}

/**
 * An Absent day filled from the Exceptions page: its clock in and clock out
 * in one request, and the absence resolved. A supervisor's goes to HR for
 * approval, both punches together (sendFromExceptions).
 */
export const addAbsentDayPunches = withRBAC(
  ["PUNCH_EDIT_TEAM", "PUNCH_FIX_MISSED_TEAM"],
  async (ctx, input: AddAbsentDayPunchesInput) => {
    const { employeeId: supervisorId, tenantId } = ctx;
    const { timesheetId, exceptionId, inTime, outTime, reason } = addAbsentDayPunchesSchema.parse(input);
    const inAt = new Date(inTime);
    const outAt = new Date(outTime);
    if (outAt <= inAt) throw new Error("The clock out must be after the clock in.");
    if (outAt.getTime() - inAt.getTime() > 16 * 60 * 60 * 1000) throw new Error("A shift can be up to 16 hours. Check the AM and PM.");
    const sheet = await timesheetInScope(ctx, timesheetId, "PUNCH_EDIT_ANY");
    if (sheet.employeeId === supervisorId) throw new Error("You can't change your own punches");
    assertEditable(sheet.status);

    const absence = await db.exception.findFirst({
      where: { id: exceptionId, timesheetId, exceptionType: "ABSENT", resolvedAt: null },
      select: { id: true },
    });
    if (!absence) throw new Error("This absence has already been resolved, or is not on this timecard. Reload the page and try again.");
    if (await editsNeedApproval()) {
      return sendFromExceptions(ctx, sheet.employeeId, timesheetId, reason, [
        { kind: "ADD_PUNCH", punchType: "CLOCK_IN", at: inTime },
        { kind: "ADD_PUNCH", punchType: "CLOCK_OUT", at: outTime },
      ]);
    }

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: {
        employee: {
          include: {
            ruleSet: true,
            shift: { select: { startTime: true, endTime: true, workDays: true } },
            site: { select: { timezone: true } },
          },
        },
      },
    });
    const { ruleSet, shift } = timesheet.employee;
    const tz = personTimeZone(timesheet.employee, "UTC");

    await db.$transaction(async (tx) => {
      for (const [punchType, punchTime] of [["CLOCK_IN", inAt], ["CLOCK_OUT", outAt]] as const) {
        await tx.punch.create({
          data: {
            employeeId: timesheet.employeeId,
            timesheetId,
            punchType,
            punchTime,
            roundedTime: computeRoundedTime(punchTime, punchType, ruleSet, shift, tz),
            source: "MANUAL",
            stateBefore: punchType === "CLOCK_IN" ? "OUT" : "WORK",
            stateAfter: STATE_AFTER[punchType] ?? "OUT",
            isApproved: true,
            approvedById: supervisorId,
            approvedAt: new Date(),
            note: reason,
          },
        });
      }
      await tx.exception.updateMany({
        where: { id: exceptionId, timesheetId },
        data: { resolvedAt: new Date(), resolvedById: supervisorId, resolution: reason },
      });
      await writeAuditLog({
        tenantId,
        actorId: supervisorId,
        action: "PUNCH_ADDED",
        entityType: "PUNCH",
        entityId: timesheetId,
        changes: { after: { punchType: "CLOCK_IN", punchTime: inTime, clockOut: outTime, reason } },
      });
    });

    await rebuildSegments(timesheetId, timesheet.employee.ruleSet);
    revalidatePath("/supervisor/exceptions");
    revalidatePath("/time/history");
    revalidatePath(`/time/timesheet/${timesheetId}`);
    return { pending: false };
  }
);

/** Supervisor corrects a punch time and auto-resolves the exception. */
export const correctPunchAndResolve = withRBAC(
  // A supervisor's change goes to HR for approval (sendFromExceptions).
  ["PUNCH_EDIT_TEAM", "PUNCH_FIX_MISSED_TEAM"],
  async (ctx, input: CorrectAndResolveInput) => {
    const { employeeId: supervisorId } = ctx;
    const { originalPunchId, newPunchTime: newPunchTimeStr, reason, exceptionId } =
      correctAndResolveSchema.parse(input);
    const newPunchTime = new Date(newPunchTimeStr);
    // Only a punch of someone the caller manages, and not their own.
    const scoped = await punchInScope(ctx, originalPunchId, "PUNCH_EDIT_ANY");
    if (scoped.employeeId === supervisorId) throw new Error("You can't change your own punches");
    if (await editsNeedApproval()) {
      const { timesheetId: onSheet } = await db.punch.findUniqueOrThrow({ where: { id: originalPunchId }, select: { timesheetId: true } });
      if (!onSheet) throw new Error("This punch is not on a timecard yet. Ask HR or payroll to change it.");
      const sheet = await timesheetInScope(ctx, onSheet, "PUNCH_EDIT_ANY");
      assertEditable(sheet.status);
      return sendFromExceptions(ctx, sheet.employeeId, onSheet, reason, [{ kind: "CHANGE_PUNCH", punchId: originalPunchId, at: newPunchTimeStr }]);
    }

    const { timesheetId, ruleSet } = await db.$transaction(async (tx) => {
      const result = await createCorrectionPunch(tx, {
        originalPunchId,
        newPunchTime,
        reason,
        supervisorId,
      });
      // The exception must be the corrected punch's timesheet's.
      await tx.exception.updateMany({
        where: { id: exceptionId, timesheetId: result.timesheetId },
        data: { resolvedAt: new Date(), resolvedById: supervisorId, resolution: reason },
      });
      return result;
    });

    await rebuildSegments(timesheetId, ruleSet);
    revalidatePath("/supervisor/exceptions");
    revalidatePath("/time/history");
    revalidatePath(`/time/timesheet/${timesheetId}`);
    return { pending: false };
  }
);

// ─── Supervisor leave queue ───────────────────────────────────────────────────

/**
 * Pending leave requests for the supervisor's team (or all PENDING for payroll+).
 */
export const getTeamLeaveRequests = withRBAC(
  "LEAVE_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { siteId, departmentId, shiftId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
    }).parse(input ?? {});

    const employeeFilter = await leaveEmployees({ employeeId, role, tenantId }, { siteId, departmentId, shiftId });
    if (!employeeFilter) return [];

    return db.leaveRequest.findMany({
      where: { status: "PENDING", employee: employeeFilter },
      include: {
        employee: {
          select: {
            user: { select: { name: true } },
            department: { select: { id: true, name: true } },
            // The building: a department is the same one at every site, so
            // only someone in it at the same site clashes (leave-tabs).
            site: { select: { id: true } },
          },
        },
        leaveType: true,
      },
      orderBy: { submittedAt: "asc" },
    });
  }
);

// ─── Team headcount, for the coverage panel ──────────────────────────────────

/**
 * How many people the approver is responsible for, split by department.
 *
 * <p>This is the denominator in "48 of 52 on shift". It is deliberately a
 * separate query rather than a count over the leave rows, because the people
 * who are *not* off never appear in a leave list, and a coverage figure built
 * only from people who asked for leave would always read as full staffing.
 *
 * <p>Scoped exactly like the three leave queues above and behind the same
 * permission, so it can never report a headcount for a department whose leave
 * the caller is not allowed to see. Counted in SQL with groupBy rather than
 * pulled and length-ed in JS, because a site can hold a few thousand people.
 */
export const getTeamHeadcount = withRBAC(
  "LEAVE_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { siteId, departmentId, shiftId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
    }).parse(input ?? {});

    const employeeFilter = await leaveEmployees({ employeeId, role, tenantId }, { siteId, departmentId, shiftId });
    if (!employeeFilter) return { total: 0, byDepartment: [] };

    // By department at each site: a department is the same one at every
    // site, and who covers the work is the people in it in the same building.
    const grouped = await db.employee.groupBy({
      by: ["departmentId", "siteId"],
      where: withoutVisitors({ ...employeeFilter, isActive: true }),
      _count: { _all: true },
    });

    const [names, sites] = await Promise.all([
      db.department.findMany({ where: { id: { in: grouped.map((g) => g.departmentId) } }, select: { id: true, name: true } }),
      db.site.findMany({ where: { id: { in: grouped.map((g) => g.siteId) } }, select: { id: true, name: true } }),
    ]);
    const nameById = new Map(names.map((d) => [d.id, d.name]));
    const siteById = new Map(sites.map((s) => [s.id, s.name]));

    return {
      total: grouped.reduce((sum, g) => sum + g._count._all, 0),
      byDepartment: grouped.map((g) => ({
        id: g.departmentId,
        name: nameById.get(g.departmentId) ?? "Unassigned",
        siteId: g.siteId,
        siteName: siteById.get(g.siteId) ?? "",
        count: g._count._all,
      })),
    };
  }
);

// ─── HR-pending leave ────────────────────────────────────────────────────────

/**
 * PENDING_HR leave requests awaiting HR/Payroll approval.
 * Payroll+ see all; supervisors see their team only.
 */
export const getHrPendingLeave = withRBAC(
  "LEAVE_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { siteId, departmentId, shiftId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
    }).parse(input ?? {});

    const employeeFilter = await leaveEmployees({ employeeId, role, tenantId }, { siteId, departmentId, shiftId });
    if (!employeeFilter) return [];

    return db.leaveRequest.findMany({
      where: { status: "PENDING_HR", employee: employeeFilter },
      include: {
        employee: {
          select: {
            user: { select: { name: true } },
            department: { select: { id: true, name: true } },
            // The building: a department is the same one at every site, so
            // only someone in it at the same site clashes (leave-tabs).
            site: { select: { id: true } },
          },
        },
        leaveType: true,
      },
      orderBy: { submittedAt: "asc" },
    });
  }
);

// ─── Upcoming approved leave ─────────────────────────────────────────────────

/**
 * Approved / posted leave for the supervisor's team (or all for payroll+).
 * Returns requests whose end date is today or in the future.
 */
export const getUpcomingTeamLeave = withRBAC(
  "LEAVE_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { siteId, departmentId, shiftId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
    }).parse(input ?? {});

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const employeeFilter = await leaveEmployees({ employeeId, role, tenantId }, { siteId, departmentId, shiftId });
    if (!employeeFilter) return [];

    return db.leaveRequest.findMany({
      where: {
        status: { in: ["APPROVED", "POSTED"] },
        endDate: { gte: today },
        employee: employeeFilter,
      },
      include: {
        employee: {
          select: {
            user: { select: { name: true } },
            department: { select: { id: true, name: true } },
            // The building: a department is the same one at every site, so
            // only someone in it at the same site clashes (leave-tabs).
            site: { select: { id: true } },
          },
        },
        leaveType: true,
      },
      orderBy: { startDate: "asc" },
    });
  }
);
