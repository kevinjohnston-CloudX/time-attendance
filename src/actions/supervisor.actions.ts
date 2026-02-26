"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { applyRounding } from "@/lib/utils/date";
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

const resolveExceptionSchema = z.object({
  exceptionId: z.string().min(1),
  resolution: z.string().min(1, "Resolution note is required"),
});

export const resolveException = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId }, input: z.infer<typeof resolveExceptionSchema>) => {
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

const addMissingPunchSchema = z.object({
  timesheetId: z.string().min(1),
  exceptionId: z.string().min(1),
  punchType: z.enum(["CLOCK_IN", "MEAL_START", "MEAL_END", "CLOCK_OUT", "BREAK_START", "BREAK_END"]),
  punchTime: z.string().min(1),
  reason: z.string().min(1, "Reason is required"),
});

/** Supervisor adds a missing punch directly, auto-resolving the exception. */
export const addMissingPunchForEmployee = withRBAC(
  "PUNCH_EDIT_TEAM",
  async ({ employeeId: supervisorId }, input: z.infer<typeof addMissingPunchSchema>) => {
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
    revalidatePath(`/time/timesheet/${timesheetId}`);
  }
);

const correctAndResolveSchema = z.object({
  originalPunchId: z.string().min(1),
  newPunchTime: z.string().min(1),
  reason: z.string().min(1, "Reason is required"),
  exceptionId: z.string().min(1),
});

/** Supervisor corrects a punch time and auto-resolves the exception. */
export const correctPunchAndResolve = withRBAC(
  "PUNCH_EDIT_TEAM",
  async ({ employeeId: supervisorId }, input: z.infer<typeof correctAndResolveSchema>) => {
    const { originalPunchId, newPunchTime: newPunchTimeStr, reason, exceptionId } =
      correctAndResolveSchema.parse(input);
    const newPunchTime = new Date(newPunchTimeStr);

    const original = await db.punch.findUniqueOrThrow({
      where: { id: originalPunchId },
      include: { employee: { include: { ruleSet: true } } },
    });

    if (original.correctedById) throw new Error("Punch has already been corrected.");

    const roundedTime = applyRounding(newPunchTime, original.employee.ruleSet.punchRoundingMinutes);

    await db.$transaction(async (tx) => {
      const c = await tx.punch.create({
        data: {
          employeeId: original.employeeId,
          timesheetId: original.timesheetId,
          punchType: original.punchType,
          punchTime: newPunchTime,
          roundedTime,
          source: "MANUAL",
          stateBefore: original.stateBefore,
          stateAfter: original.stateAfter,
          isApproved: true,
          approvedById: supervisorId,
          approvedAt: new Date(),
          note: reason,
          correctsId: original.id,
        },
      });
      await tx.punch.update({ where: { id: original.id }, data: { correctedById: c.id } });
      await tx.exception.update({
        where: { id: exceptionId },
        data: { resolvedAt: new Date(), resolvedById: supervisorId, resolution: reason },
      });
      await writeAuditLog({
        actorId: supervisorId,
        action: "PUNCH_CORRECTED",
        entityType: "PUNCH",
        entityId: c.id,
        changes: { before: { punchTime: original.punchTime }, after: { punchTime: newPunchTime, reason } },
      });
    });

    await rebuildSegments(original.timesheetId, original.employee.ruleSet);
    revalidatePath("/supervisor/exceptions");
    revalidatePath(`/time/timesheet/${original.timesheetId}`);
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
