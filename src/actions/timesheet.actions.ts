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
import type { Timesheet } from "@prisma/client";

// ─── recalculateSegments ──────────────────────────────────────────────────────

export const recalculateSegments = withRBAC(
  "TIMESHEET_SUBMIT_OWN",
  async ({ employeeId }, input: TimesheetIdInput): Promise<void> => {
    const parsed = timesheetIdSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: parsed.data.timesheetId },
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
    const parsed = timesheetIdSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: parsed.data.timesheetId },
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
    const parsed = timesheetIdSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: parsed.data.timesheetId },
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
    revalidatePath(`/time/timesheet/${timesheet.id}`);
    return updated;
  }
);

// ─── rejectTimesheet (supervisor or payroll) ──────────────────────────────────

export const rejectTimesheet = withRBAC(
  "TIMESHEET_APPROVE_TEAM",
  async ({ employeeId: reviewerId }, input: RejectTimesheetInput): Promise<Timesheet> => {
    const parsed = rejectTimesheetSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const { timesheetId, note } = parsed.data;
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
    revalidatePath(`/time/timesheet/${timesheet.id}`);
    return updated;
  }
);

// ─── payrollApproveTimesheet ──────────────────────────────────────────────────

export const payrollApproveTimesheet = withRBAC(
  "TIMESHEET_APPROVE_ANY",
  async ({ employeeId: payrollId }, input: TimesheetIdInput): Promise<Timesheet> => {
    const parsed = timesheetIdSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: parsed.data.timesheetId },
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
    revalidatePath(`/time/timesheet/${timesheet.id}`);
    return updated;
  }
);
