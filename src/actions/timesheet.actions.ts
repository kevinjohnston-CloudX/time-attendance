"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import {
  validateTimesheetTransition,
} from "@/lib/state-machines/timesheet-state";
import {
  timesheetIdSchema,
  rejectTimesheetSchema,
  type TimesheetIdInput,
  type RejectTimesheetInput,
} from "@/lib/validators/timesheet.schema";
import { z } from "zod";
import type { Timesheet } from "@prisma/client";

// ─── recalculateSegments ──────────────────────────────────────────────────────

export const recalculateSegments = withRBAC(
  "TIMESHEET_SUBMIT_OWN",
  async ({ employeeId }, input: TimesheetIdInput): Promise<void> => {
    const { timesheetId } = timesheetIdSchema.parse(input);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });

    if (timesheet.employeeId !== employeeId)
      throw new Error("Cannot access another employee's timesheet.");

    await rebuildSegments(timesheet.id, timesheet.employee.ruleSet);
    revalidatePath(`/time/timesheet/${timesheet.id}`);
  }
);

// ─── recalculateSegmentsAdmin ─────────────────────────────────────────────────

export const recalculateSegmentsAdmin = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: TimesheetIdInput): Promise<void> => {
    const { timesheetId } = timesheetIdSchema.parse(input);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });

    await rebuildSegments(timesheet.id, timesheet.employee.ruleSet);
    revalidatePath("/payroll/timecards");
  }
);

// ─── submitTimesheet ──────────────────────────────────────────────────────────

export const submitTimesheet = withRBAC(
  "TIMESHEET_SUBMIT_OWN",
  async ({ employeeId, tenantId }, input: TimesheetIdInput): Promise<Timesheet> => {
    const { timesheetId } = timesheetIdSchema.parse(input);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
    });

    if (timesheet.employeeId !== employeeId)
      throw new Error("Cannot submit another employee's timesheet.");

    const transition = validateTimesheetTransition(timesheet.status, "SUBMIT");
    if (!transition.valid) throw new Error(transition.error);

    const unresolvedExceptions = await db.exception.count({
      where: { timesheetId: timesheet.id, resolvedAt: null },
    });
    if (unresolvedExceptions > 0)
      throw new Error(
        `Cannot submit: ${unresolvedExceptions} unresolved exception(s) remain.`
      );

    const updated = await db.$transaction(async (tx) => {
      const t = await tx.timesheet.update({
        where: { id: timesheet.id },
        data: { status: transition.newStatus, submittedAt: new Date() },
      });
      await writeAuditLog({
        tenantId,
        actorId: employeeId,
        action: "TIMESHEET_SUBMITTED",
        entityType: "TIMESHEET",
        entityId: t.id,
        changes: { before: { status: timesheet.status }, after: { status: t.status } },
      });
      return t;
    });

    revalidatePath("/time/timesheet");
    revalidatePath(`/time/timesheet/${timesheet.id}`);
    return updated;
  }
);

// ─── approveTimesheet (supervisor) ───────────────────────────────────────────

export const approveTimesheet = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId: supervisorId, tenantId }, input: TimesheetIdInput): Promise<Timesheet> => {
    const { timesheetId } = timesheetIdSchema.parse(input);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
    });

    const transition = validateTimesheetTransition(timesheet.status, "SUP_APPROVE");
    if (!transition.valid) throw new Error(transition.error);

    const updated = await db.$transaction(async (tx) => {
      const t = await tx.timesheet.update({
        where: { id: timesheet.id },
        data: {
          status: transition.newStatus,
          supApprovedAt: new Date(),
          supApprovedById: supervisorId,
        },
      });
      await writeAuditLog({
        tenantId,
        actorId: supervisorId,
        action: "TIMESHEET_SUP_APPROVED",
        entityType: "TIMESHEET",
        entityId: t.id,
        changes: { before: { status: timesheet.status }, after: { status: t.status } },
      });
      return t;
    });

    revalidatePath("/supervisor/timesheets");
    revalidatePath("/payroll/timecards");
    revalidatePath(`/time/timesheet/${timesheet.id}`);
    return updated;
  }
);

// ─── rejectTimesheet (supervisor or payroll) ──────────────────────────────────

export const rejectTimesheet = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId: reviewerId, tenantId }, input: RejectTimesheetInput): Promise<Timesheet> => {
    const { timesheetId, note } = rejectTimesheetSchema.parse(input);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
    });

    // Supervisor rejects SUBMITTED; Payroll rejects SUP_APPROVED
    const event =
      timesheet.status === "SUBMITTED" ? "SUP_REJECT" : "PAYROLL_REJECT";
    const transition = validateTimesheetTransition(timesheet.status, event);
    if (!transition.valid) throw new Error(transition.error);

    const updated = await db.$transaction(async (tx) => {
      const t = await tx.timesheet.update({
        where: { id: timesheet.id },
        data: {
          status: transition.newStatus,
          rejectedAt: new Date(),
          rejectedById: reviewerId,
          rejectionNote: note,
        },
      });
      await writeAuditLog({
        tenantId,
        actorId: reviewerId,
        action: "TIMESHEET_REJECTED",
        entityType: "TIMESHEET",
        entityId: t.id,
        changes: { before: { status: timesheet.status }, after: { status: t.status, note } },
      });
      return t;
    });

    revalidatePath("/supervisor/timesheets");
    revalidatePath("/payroll/timecards");
    revalidatePath(`/time/timesheet/${timesheet.id}`);
    return updated;
  }
);

// ─── payrollApproveTimesheet ──────────────────────────────────────────────────

export const payrollApproveTimesheet = withRBAC(
  "TIMESHEET_APPROVE_ANY",
  async ({ employeeId: payrollId, tenantId }, input: TimesheetIdInput): Promise<Timesheet> => {
    const { timesheetId } = timesheetIdSchema.parse(input);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
    });

    const transition = validateTimesheetTransition(timesheet.status, "PAYROLL_APPROVE");
    if (!transition.valid) throw new Error(transition.error);

    const updated = await db.$transaction(async (tx) => {
      const t = await tx.timesheet.update({
        where: { id: timesheet.id },
        data: {
          status: transition.newStatus,
          payrollApprovedAt: new Date(),
          payrollApprovedById: payrollId,
        },
      });
      await writeAuditLog({
        tenantId,
        actorId: payrollId,
        action: "TIMESHEET_PAYROLL_APPROVED",
        entityType: "TIMESHEET",
        entityId: t.id,
        changes: { before: { status: timesheet.status }, after: { status: t.status } },
      });
      return t;
    });

    revalidatePath("/payroll");
    revalidatePath("/payroll/timecards");
    revalidatePath(`/time/timesheet/${timesheet.id}`);
    return updated;
  }
);

// ─── toggleMealWaiver ─────────────────────────────────────────────────────────

const mealWaiverSchema = z.object({
  timesheetId: z.string().cuid(),
  segmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd"),
});

export const toggleMealWaiver = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown): Promise<{ success: boolean; waived: boolean }> => {
    const { timesheetId, segmentDate } = mealWaiverSchema.parse(input);

    const dateObj = new Date(segmentDate + "T00:00:00.000Z");

    const existing = await db.mealWaiver.findUnique({
      where: { timesheetId_segmentDate: { timesheetId, segmentDate: dateObj } },
    });

    if (existing) {
      await db.$transaction(async (tx) => {
        await tx.mealWaiver.delete({ where: { id: existing.id } });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_WAIVER_REMOVED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { before: { segmentDate, createdById: existing.createdById }, after: null },
        });
      });
    } else {
      await db.$transaction(async (tx) => {
        await tx.mealWaiver.create({
          data: { timesheetId, segmentDate: dateObj, createdById: actorId },
        });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_WAIVER_ADDED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { before: null, after: { segmentDate, createdById: actorId } },
        });
      });
    }

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });
    await rebuildSegments(timesheetId, timesheet.employee.ruleSet);
    revalidatePath("/payroll/timecards");

    return { success: true, waived: !existing };
  }
);

// ─── toggleMealPremiumWaiver ──────────────────────────────────────────────────

const mealPremiumWaiverSchema = z.object({
  timesheetId: z.string().cuid(),
  segmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd"),
  segmentStart: z.string().datetime(),
});

export const toggleMealPremiumWaiver = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown): Promise<{ success: boolean; waived: boolean }> => {
    const { timesheetId, segmentDate, segmentStart } = mealPremiumWaiverSchema.parse(input);

    const dateObj = new Date(segmentDate + "T00:00:00.000Z");
    const startObj = new Date(segmentStart);

    const existing = await db.mealPremiumWaiver.findUnique({
      where: { timesheetId_segmentStart: { timesheetId, segmentStart: startObj } },
    });

    if (existing) {
      await db.$transaction(async (tx) => {
        await tx.mealPremiumWaiver.delete({ where: { id: existing.id } });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_PREMIUM_WAIVER_REMOVED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { before: { segmentDate, segmentStart, createdById: existing.createdById }, after: null },
        });
      });
    } else {
      await db.$transaction(async (tx) => {
        await tx.mealPremiumWaiver.create({
          data: { timesheetId, segmentDate: dateObj, segmentStart: startObj, createdById: actorId },
        });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_PREMIUM_WAIVER_ADDED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { before: null, after: { segmentDate, segmentStart, createdById: actorId } },
        });
      });
    }

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });
    await rebuildSegments(timesheetId, timesheet.employee.ruleSet);
    revalidatePath("/payroll/timecards");

    return { success: true, waived: !existing };
  }
);

// ─── authorizeTimecardOt ──────────────────────────────────────────────────────

export const authorizeTimecardOt = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId: actorId, tenantId }, input: TimesheetIdInput): Promise<{ success: boolean }> => {
    const { timesheetId } = timesheetIdSchema.parse(input);

    await db.$transaction(async (tx) => {
      await tx.timesheet.update({
        where: { id: timesheetId },
        data: { otAuthorized: true },
      });
      await writeAuditLog({
        tenantId,
        actorId,
        action: "OT_AUTHORIZED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: { before: { otAuthorized: false }, after: { otAuthorized: true } },
      });
    });

    revalidatePath("/supervisor/timesheets");
    revalidatePath("/payroll/timecards");

    return { success: true };
  }
);
