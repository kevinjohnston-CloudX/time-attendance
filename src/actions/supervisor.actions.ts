"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { createCorrectionPunch } from "@/lib/utils/punch-correction";
import { applyRounding } from "@/lib/utils/date";
import {
  resolveExceptionSchema,
  addMissingPunchSchema,
  correctAndResolveSchema,
  type ResolveExceptionInput,
  type AddMissingPunchInput,
  type CorrectAndResolveInput,
} from "@/lib/validators/supervisor.schema";
import { z } from "zod";
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
  async ({ employeeId, role }, _input: void) => {
    const isPayroll = PAYROLL_ROLES.includes(role);

    return db.timesheet.findMany({
      where: isPayroll
        ? { status: "SUP_APPROVED" }
        : { employee: { supervisorId: employeeId }, status: "SUBMITTED" },
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
  async ({ employeeId, role }, _input: void) => {
    const isPayroll = PAYROLL_ROLES.includes(role);

    return db.exception.findMany({
      where: {
        resolvedAt: null,
        ...(isPayroll
          ? {}
          : { timesheet: { employee: { supervisorId: employeeId } } }),
      },
      include: {
        timesheet: {
          include: {
            employee: { include: { user: true } },
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
  async ({ employeeId }, input: ResolveExceptionInput) => {
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
  async ({ employeeId: supervisorId }, input: AddMissingPunchInput) => {
    const { timesheetId, exceptionId, punchType, punchTime: punchTimeStr, reason } =
      addMissingPunchSchema.parse(input);
    const punchTime = new Date(punchTimeStr);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });

    const roundedTime = applyRounding(punchTime, timesheet.employee.ruleSet.punchRoundingMinutes);

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
  async ({ employeeId, role }, _input: void) => {
    const isPayroll = PAYROLL_ROLES.includes(role);

    return db.leaveRequest.findMany({
      where: {
        status: "PENDING",
        ...(isPayroll
          ? {}
          : { employee: { supervisorId: employeeId } }),
      },
      include: {
        employee: { include: { user: true } },
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
  async ({ employeeId, role }, _input: void) => {
    const isPayroll = PAYROLL_ROLES.includes(role);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return db.leaveRequest.findMany({
      where: {
        status: { in: ["APPROVED", "POSTED"] },
        endDate: { gte: today },
        ...(isPayroll
          ? {}
          : { employee: { supervisorId: employeeId } }),
      },
      include: {
        employee: { include: { user: true } },
        leaveType: true,
      },
      orderBy: { startDate: "asc" },
    });
  }
);
