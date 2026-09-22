"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { createCorrectionPunch } from "@/lib/utils/punch-correction";
import { computeRoundedTime } from "@/lib/utils/date";
import {
  resolveExceptionSchema,
  addMissingPunchSchema,
  correctAndResolveSchema,
  type ResolveExceptionInput,
  type AddMissingPunchInput,
  type CorrectAndResolveInput,
} from "@/lib/validators/supervisor.schema";
import { z } from "zod";
import { ExceptionType } from "@prisma/client";
import type { Role } from "@/lib/rbac/roles";
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

    return db.timesheet.findMany({
      where: isPayroll
        ? { status: "SUP_APPROVED", employee: { tenantId: t } }
        : { employee: { supervisorId: employeeId, tenantId: t }, status: "SUBMITTED" },
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
  async ({ employeeId: reviewerId, role }, input: { timesheetId: string }) => {
    const { timesheetId } = z.object({ timesheetId: z.string() }).parse(input);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: {
        payPeriod: true,
        employee: { include: { user: true } },
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
    const isSupervisor =
      timesheet.employee.supervisorId === reviewerId;

    if (!isPayroll && !isSupervisor) {
      throw new Error("You do not have access to this timesheet");
    }

    return timesheet;
  }
);

// ─── Exceptions ───────────────────────────────────────────────────────────────

/** All unresolved exceptions for the supervisor's team (or all if payroll+). */
export const getTeamExceptions = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId, role, tenantId }, input: unknown) => {
    const { siteId, departmentId, exceptionType, payPeriodId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
      exceptionType: z.nativeEnum(ExceptionType).optional(),
      payPeriodId: z.string().optional(),
    }).parse(input ?? {});

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    const employeeFilter = {
      tenantId: t,
      ...(isPayroll ? {} : { supervisorId: employeeId }),
      ...(siteId ? { siteId } : {}),
      ...(departmentId ? { departmentId } : {}),
    };

    return db.exception.findMany({
      where: {
        resolvedAt: null,
        exceptionType: { in: Object.values(ExceptionType) },
        ...(exceptionType ? { exceptionType } : {}),
        timesheet: {
          ...(payPeriodId ? { payPeriodId } : {}),
          employee: employeeFilter,
        },
      },
      include: {
        timesheet: {
          include: {
            employee: { include: { user: true, site: true, department: true } },
            payPeriod: true,
            punches: {
              where: { isApproved: true, correctedById: null },
              orderBy: { roundedTime: "asc" },
            },
          },
        },
      },
      orderBy: { occurredAt: "asc" },
    });
  }
);

export const resolveException = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId, tenantId }, input: ResolveExceptionInput) => {
    const { exceptionId, resolution } = resolveExceptionSchema.parse(input);

    const exception = await db.exception.findUniqueOrThrow({
      where: { id: exceptionId },
    });

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
  async ({ employeeId: supervisorId, tenantId }, input: AddMissingPunchInput) => {
    const { timesheetId, exceptionId, punchType, punchTime: punchTimeStr, reason } =
      addMissingPunchSchema.parse(input);
    const punchTime = new Date(punchTimeStr);

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
      await tx.exception.update({
        where: { id: exceptionId },
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
  async ({ employeeId: supervisorId }, input: CorrectAndResolveInput) => {
    const { originalPunchId, newPunchTime: newPunchTimeStr, reason, exceptionId } =
      correctAndResolveSchema.parse(input);
    const newPunchTime = new Date(newPunchTimeStr);

    const { timesheetId, ruleSet } = await db.$transaction(async (tx) => {
      const result = await createCorrectionPunch(tx, {
        originalPunchId,
        newPunchTime,
        reason,
        supervisorId,
      });
      await tx.exception.update({
        where: { id: exceptionId },
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
    const { siteId, departmentId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
    }).parse(input ?? {});

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    const employeeFilter = isPayroll
      ? { tenantId: t, ...(siteId ? { siteId } : {}), ...(departmentId ? { departmentId } : {}) }
      : { supervisorId: employeeId, tenantId: t };

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
    const { siteId, departmentId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
    }).parse(input ?? {});

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    const employeeFilter = isPayroll
      ? { tenantId: t, ...(siteId ? { siteId } : {}), ...(departmentId ? { departmentId } : {}) }
      : { supervisorId: employeeId, tenantId: t };

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
    const { siteId, departmentId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
    }).parse(input ?? {});

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;

    const employeeFilter = isPayroll
      ? { tenantId: t, ...(siteId ? { siteId } : {}), ...(departmentId ? { departmentId } : {}) }
      : { supervisorId: employeeId, tenantId: t };

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
    const { siteId, departmentId } = z.object({
      siteId: z.string().optional(),
      departmentId: z.string().optional(),
    }).parse(input ?? {});

    const isPayroll = PAYROLL_ROLES.includes(role);
    const t = tenantId ?? undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const employeeFilter = isPayroll
      ? { tenantId: t, ...(siteId ? { siteId } : {}), ...(departmentId ? { departmentId } : {}) }
      : { supervisorId: employeeId, tenantId: t };

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
