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

// ─── submitTimesheet ──────────────────────────────────────────────────────────

export const submitTimesheet = withRBAC(
  "TIMESHEET_SUBMIT_OWN",
  async ({ employeeId }, input: TimesheetIdInput): Promise<Timesheet> => {
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
  async ({ employeeId: supervisorId }, input: TimesheetIdInput): Promise<Timesheet> => {
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
  async ({ employeeId: reviewerId }, input: RejectTimesheetInput): Promise<Timesheet> => {
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
  async ({ employeeId: payrollId }, input: TimesheetIdInput): Promise<Timesheet> => {
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
  reason: z.string().max(500).optional(),
});

export const toggleMealWaiver = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ employeeId: actorId }, input: unknown): Promise<{ success: boolean; waived: boolean }> => {
    const { timesheetId, segmentDate, reason } = mealWaiverSchema.parse(input);

    const dateObj = new Date(segmentDate + "T00:00:00.000Z");

    const existing = await db.mealWaiver.findUnique({
      where: { timesheetId_segmentDate: { timesheetId, segmentDate: dateObj } },
    });

    if (existing) {
      await db.$transaction(async (tx) => {
        await tx.mealWaiver.delete({ where: { id: existing.id } });
        await writeAuditLog({
          actorId,
          action: "MEAL_WAIVER_REMOVED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { before: { segmentDate, reason: existing.reason }, after: null },
        });
      });
    } else {
      await db.$transaction(async (tx) => {
        await tx.mealWaiver.create({
          data: { timesheetId, segmentDate: dateObj, reason: reason ?? "" },
        });
        await writeAuditLog({
          actorId,
          action: "MEAL_WAIVER_ADDED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { before: null, after: { segmentDate, reason } },
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
