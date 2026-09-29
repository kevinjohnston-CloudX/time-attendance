"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { createCorrectionPunch } from "@/lib/utils/punch-correction";
import { assertEditable, punchInScope, timesheetInScope } from "@/lib/rbac/scope";
import { computeRoundedTime } from "@/lib/utils/date";
import { scheduledWindow } from "@/lib/utils/shift-schedule";
import {
  resolveExceptionSchema,
  addMissingPunchSchema,
  correctAndResolveSchema,
  type ResolveExceptionInput,
  type AddMissingPunchInput,
  type CorrectAndResolveInput,
} from "@/lib/validators/supervisor.schema";
import { format, endOfDay, startOfDay } from "date-fns";
import { z } from "zod";
import { ExceptionType } from "@prisma/client";
import type { Role } from "@/lib/rbac/roles";
import { getSubordinateIds } from "@/lib/get-subordinate-ids";
import type { PunchState, PunchType } from "@prisma/client";

const PAYROLL_ROLES: Role[] = ["PAYROLL_ADMIN", "HR_ADMIN", "SYSTEM_ADMIN"];

// ─── Team timesheets ──────────────────────────────────────────────────────────

/**
 * Supervisors see their team's SUBMITTED timesheets.
 * Payroll+ sees all SUP_APPROVED timesheets.
 */
export const getTeamTimesheets = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, _input: void) => {
    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    let timesheetWhere: Prisma.TimesheetWhereInput;
    if (isPayroll) {
      timesheetWhere = { status: "SUP_APPROVED", employee: { tenantId: t } };
    } else {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return [];
      timesheetWhere = { employee: { id: { in: subordinateIds }, tenantId: t }, status: "SUBMITTED" };
    }

    return db.timesheet.findMany({
      where: timesheetWhere,
      include: {
        employee: { include: { user: true } },
        payPeriod: true,
        overtimeBuckets: true,
        exceptions: { where: { resolvedAt: null } },
      },
      orderBy: { updatedAt: "asc" },
    });
  }
);

/** Full timesheet detail — accessible by supervisor of that employee or payroll+. */
export const getTimesheetForReview = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async (ctx, input: { timesheetId: string }) => {
    const { employeeId: reviewerId, role } = ctx;
    const { timesheetId } = z.object({ timesheetId: z.string() }).parse(input);
    // Found only inside the caller's company and team.
    await timesheetInScope(ctx, timesheetId, "TIMESHEET_APPROVE_ANY");

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: {
        payPeriod: true,
        // Never the whole login row: it carries the password hash.
        employee: { include: { user: { select: { id: true, name: true, email: true } } } },
        punches: {
          where: { isApproved: true, correctedById: null },
          orderBy: { roundedTime: "asc" },
        },
        segments: { orderBy: { startTime: "asc" } },
        overtimeBuckets: true,
        exceptions: { where: { resolvedAt: null } },
      },
    });

    const isPayroll = PAYROLL_ROLES.includes(role);
    if (!isPayroll) {
      const subordinateIds = await getSubordinateIds(reviewerId, timesheet.employee.tenantId);
      if (!subordinateIds.includes(timesheet.employeeId)) {
        throw new Error("You do not have access to this timesheet");
      }
    }

    return timesheet;
  }
);

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
    const { siteId, departmentId, shiftId, exceptionType, payPeriodId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
      exceptionType: z.nativeEnum(ExceptionType).optional(),
      payPeriodId: z.string().optional(),
    }).parse(input ?? {});

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    let idFilter: { id?: { in: string[] } } = {};
    if (!isPayroll) {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return [];
      idFilter = { id: { in: subordinateIds } };
    }
    const employeeFilter = {
      tenantId: t,
      ...idFilter,
      ...(siteId ? { siteId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(shiftId ? { shiftId } : {}),
    };

    const rows = await db.exception.findMany({
      where: {
        resolvedAt: null,
        exceptionType: { in: Object.values(ExceptionType) },
        ...(exceptionType ? { exceptionType } : {}),
        timesheet: {
          ...(payPeriodId ? { payPeriodId } : {}),
          employee: employeeFilter,
        },
      },
      select: {
        id: true,
        exceptionType: true,
        description: true,
        occurredAt: true,
        timesheetId: true,
        timesheet: {
          select: {
            employeeId: true,
            employee: {
              select: {
                shiftId:    true,
                user:       { select: { name: true } },
                site:       { select: { name: true } },
                department: { select: { name: true } },
              },
            },
            payPeriod: { select: { id: true, startDate: true, endDate: true } },
            _count: { select: { punches: { where: { isApproved: true, correctedById: null } } } },
          },
        },
      },
      orderBy: { occurredAt: "asc" },
    });

    /**
     * What the day was scheduled as, and what was actually recorded on it.
     *
     * <p>Two more queries rather than two more includes, and that is the whole
     * point. Including the punches is what made this page 25MB: roughly three
     * exceptions share a timesheet, so every punch on that sheet was
     * serialised three times over. Here the punch read is narrowed to clock in
     * and clock out, to the sheets already in the result, to the days those
     * exceptions fell on, and to three columns, and nothing but two short
     * strings per card ever reaches the browser.
     *
     * <p>The days are bucketed with the same format() the action panel uses
     * rather than by grouping on rounded_time::date in Postgres. The database
     * would do the arithmetic in one query fewer and would put a night shift's
     * clock out on the following day, because the column is stored in UTC.
     */
    const timesheetIds = Array.from(new Set(rows.map((r) => r.timesheetId)));
    const recorded = new Map<string, { in: string | null; out: string | null }>();

    if (timesheetIds.length > 0) {
      let earliest = rows[0].occurredAt;
      let latest = rows[0].occurredAt;
      for (const r of rows) {
        if (r.occurredAt < earliest) earliest = r.occurredAt;
        if (r.occurredAt > latest) latest = r.occurredAt;
      }

      const punches = await db.punch.findMany({
        where: {
          timesheetId: { in: timesheetIds },
          punchType: { in: ["CLOCK_IN", "CLOCK_OUT"] },
          isApproved: true,
          correctedById: null,
          roundedTime: { gte: startOfDay(earliest), lte: endOfDay(latest) },
        },
        select: { timesheetId: true, punchType: true, roundedTime: true },
        orderBy: { roundedTime: "asc" },
      });

      for (const p of punches) {
        if (!p.timesheetId) continue;
        const key = `${p.timesheetId}|${format(p.roundedTime, "yyyy-MM-dd")}`;
        const entry = recorded.get(key) ?? { in: null, out: null };
        // Read in time order, so the first clock in and the last clock out of
        // the day win. A split shift shows the outer edges of it, which is
        // what the exception was raised against.
        if (p.punchType === "CLOCK_IN") entry.in = entry.in ?? format(p.roundedTime, "HH:mm");
        else entry.out = format(p.roundedTime, "HH:mm");
        recorded.set(key, entry);
      }
    }

    const shiftIds = Array.from(
      new Set(rows.map((r) => r.timesheet.employee.shiftId).filter((id): id is string => !!id)),
    );
    const shifts = shiftIds.length
      ? await db.shift.findMany({
          // Scoped by the employees already in scope rather than by tenant
          // again: these ids came off rows this caller is allowed to read.
          where: { id: { in: shiftIds } },
          select: { id: true, startTime: true, endTime: true, daySchedule: true },
        })
      : [];
    const shiftById = new Map(shifts.map((sh) => [sh.id, sh]));

    return rows.map(({ timesheet, ...ex }) => ({
      ...ex,
      scheduled: scheduledWindow(
        timesheet.employee.shiftId ? shiftById.get(timesheet.employee.shiftId) : null,
        ex.occurredAt,
      ),
      recorded:
        recorded.get(`${ex.timesheetId}|${format(ex.occurredAt, "yyyy-MM-dd")}`) ??
        { in: null, out: null },
      timesheet: {
        employeeId: timesheet.employeeId,
        employee:   timesheet.employee,
        payPeriod:  timesheet.payPeriod,
        hasPunches: timesheet._count.punches > 0,
      },
    }));
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
    const { siteId, departmentId, shiftId, payPeriodId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      shiftId: z.string().optional(),
      payPeriodId: z.string().optional(),
    }).parse(input ?? {});

    const isPayroll = PAYROLL_ROLES.includes(role);

    let idFilter: { id?: { in: string[] } } = {};
    if (!isPayroll) {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return {};
      idFilter = { id: { in: subordinateIds } };
    }

    const grouped = await db.exception.groupBy({
      by: ["exceptionType"],
      where: {
        resolvedAt: null,
        timesheet: {
          ...(payPeriodId ? { payPeriodId } : {}),
          employee: {
            tenantId: tenantId ?? undefined,
            ...idFilter,
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
    const isPayroll = PAYROLL_ROLES.includes(role);

    let idFilter: { id?: { in: string[] } } = {};
    if (!isPayroll) {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return null;
      idFilter = { id: { in: subordinateIds } };
    }

    const timesheet = await db.timesheet.findFirst({
      where: {
        id: timesheetId,
        employee: {
          tenantId: tenantId ?? undefined,
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
    const sheet = await timesheetInScope(ctx, exception.timesheetId, "TIMESHEET_APPROVE_ANY");
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

/** Supervisor adds a missing punch directly, auto-resolving the exception. */
export const addMissingPunchForEmployee = withRBAC(
  "PUNCH_EDIT_TEAM",
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

    const { ruleSet, shift, site } = timesheet.employee;
    const roundedTime = computeRoundedTime(punchTime, punchType, ruleSet, shift, site?.timezone ?? "UTC");

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
  }
);

/** Supervisor corrects a punch time and auto-resolves the exception. */
export const correctPunchAndResolve = withRBAC(
  "PUNCH_EDIT_TEAM",
  async (ctx, input: CorrectAndResolveInput) => {
    const { employeeId: supervisorId } = ctx;
    const { originalPunchId, newPunchTime: newPunchTimeStr, reason, exceptionId } =
      correctAndResolveSchema.parse(input);
    const newPunchTime = new Date(newPunchTimeStr);
    // Only a punch of someone the caller manages, and not their own.
    const scoped = await punchInScope(ctx, originalPunchId, "PUNCH_EDIT_ANY");
    if (scoped.employeeId === supervisorId) throw new Error("You can't change your own punches");

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

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    let employeeFilter;
    if (isPayroll) {
      employeeFilter = {
        tenantId: t,
        ...(siteId ? { siteId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(shiftId ? { shiftId } : {}),
      };
    } else {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return [];
      employeeFilter = { id: { in: subordinateIds }, tenantId: t };
    }

    return db.leaveRequest.findMany({
      where: { status: "PENDING", employee: employeeFilter },
      include: {
        employee: {
          select: {
            user: { select: { name: true } },
            department: { select: { id: true, name: true } },
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

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    let employeeFilter;
    if (isPayroll) {
      employeeFilter = {
        tenantId: t,
        ...(siteId ? { siteId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(shiftId ? { shiftId } : {}),
      };
    } else {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return { total: 0, byDepartment: [] };
      employeeFilter = { id: { in: subordinateIds }, tenantId: t };
    }

    const grouped = await db.employee.groupBy({
      by: ["departmentId"],
      where: { ...employeeFilter, isActive: true },
      _count: { _all: true },
    });

    const names = await db.department.findMany({
      where: { id: { in: grouped.map((g) => g.departmentId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((d) => [d.id, d.name]));

    return {
      total: grouped.reduce((sum, g) => sum + g._count._all, 0),
      byDepartment: grouped.map((g) => ({
        id: g.departmentId,
        name: nameById.get(g.departmentId) ?? "Unassigned",
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

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    let employeeFilter;
    if (isPayroll) {
      employeeFilter = {
        tenantId: t,
        ...(siteId ? { siteId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(shiftId ? { shiftId } : {}),
      };
    } else {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return [];
      employeeFilter = { id: { in: subordinateIds }, tenantId: t };
    }

    return db.leaveRequest.findMany({
      where: { status: "PENDING_HR", employee: employeeFilter },
      include: {
        employee: {
          select: {
            user: { select: { name: true } },
            department: { select: { id: true, name: true } },
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

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let employeeFilter;
    if (isPayroll) {
      employeeFilter = {
        tenantId: t,
        ...(siteId ? { siteId } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(shiftId ? { shiftId } : {}),
      };
    } else {
      const subordinateIds = await getSubordinateIds(employeeId, tenantId);
      if (subordinateIds.length === 0) return [];
      employeeFilter = { id: { in: subordinateIds }, tenantId: t };
    }

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
          },
        },
        leaveType: true,
      },
      orderBy: { startDate: "asc" },
    });
  }
);
