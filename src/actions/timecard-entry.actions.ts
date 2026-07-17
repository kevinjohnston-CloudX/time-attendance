"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";
import { applyRounding } from "@/lib/utils/date";
import {
  manualPunchPairSchema,
  singleManualPunchSchema,
  payrollLeaveEntrySchema,
} from "@/lib/validators/timecard-entry.schema";
import { z } from "zod";
import type { LeaveType } from "@prisma/client";

// ─── Get leave types for timecard entry modal ─────────────────────────────────

export const getLeaveTypesForTimecard = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ tenantId }): Promise<LeaveType[]> => {
    return db.leaveType.findMany({
      where: { tenantId: tenantId!, isActive: true },
      orderBy: { name: "asc" },
    });
  }
);

// ─── Add a manual IN/OUT punch pair to a timesheet day ───────────────────────

export const addManualPunchPair = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { timesheetId, inTime, outTime, reason, payBucketOverride } =
      manualPunchPairSchema.parse(input);

    const inDate = new Date(inTime);
    const outDate = new Date(outTime);

    if (outDate <= inDate) {
      throw new Error("Out time must be after In time.");
    }

    // Load timesheet to verify editability
    const ts = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: {
        employee: { include: { ruleSet: true } },
      },
    });

    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("Cannot modify a locked or approved timesheet.");
    }

    const ruleSet = ts.employee.ruleSet;
    const roundedIn = applyRounding(inDate, ruleSet.punchRoundingMinutes);
    const roundedOut = applyRounding(outDate, ruleSet.punchRoundingMinutes);

    // Check for conflicts with existing approved punches in the time range
    const conflicting = await db.punch.findFirst({
      where: {
        timesheetId,
        isApproved: true,
        correctedById: null,
        roundedTime: { gte: roundedIn, lte: roundedOut },
      },
    });
    if (conflicting) {
      throw new Error(
        "The entered time overlaps with existing punches on this timesheet."
      );
    }

    await db.$transaction(async (tx) => {
      const punchIn = await tx.punch.create({
        data: {
          employeeId: ts.employeeId,
          timesheetId,
          punchType: "CLOCK_IN",
          punchTime: inDate,
          roundedTime: roundedIn,
          source: "MANUAL",
          stateBefore: "OUT",
          stateAfter: "WORK",
          isApproved: true,
          approvedById: actorId,
          approvedAt: new Date(),
          note: reason,
        },
      });

      await tx.punch.create({
        data: {
          employeeId: ts.employeeId,
          timesheetId,
          punchType: "CLOCK_OUT",
          punchTime: outDate,
          roundedTime: roundedOut,
          source: "MANUAL",
          stateBefore: "WORK",
          stateAfter: "OUT",
          isApproved: true,
          approvedById: actorId,
          approvedAt: new Date(),
          note: reason,
        },
      });

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "MANUAL_PUNCH_ADDED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: {
          after: { inTime, outTime, reason, source: "MANUAL" },
        },
      });

      return punchIn;
    });

    await rebuildSegments(timesheetId, ruleSet);

    // Apply pay bucket override to every WORK segment produced by this punch pair
    if (payBucketOverride) {
      const segs = await db.workSegment.findMany({
        where: {
          timesheetId,
          segmentType: "WORK",
          startTime: { gte: roundedIn, lt: roundedOut },
        },
      });
      for (const seg of segs) {
        await db.workSegment.update({
          where: { id: seg.id },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { payBucketOverride: payBucketOverride as any },
        });
      }
    }

    revalidatePath("/payroll/timecards");
  }
);

// ─── Add a single manual punch (IN or OUT) to a timesheet day ───────────────

export const addSingleManualPunch = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { timesheetId, punchType, punchTime, reason } =
      singleManualPunchSchema.parse(input);

    const punchDate = new Date(punchTime);

    const ts = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });

    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("Cannot modify a locked or approved timesheet.");
    }

    const ruleSet = ts.employee.ruleSet;
    const roundedTime = applyRounding(punchDate, ruleSet.punchRoundingMinutes);

    // Reject if another approved punch already lands at the exact same rounded time
    const conflicting = await db.punch.findFirst({
      where: { timesheetId, isApproved: true, correctedById: null, roundedTime },
    });
    if (conflicting) {
      throw new Error("A punch already exists at this time.");
    }

    await db.$transaction(async (tx) => {
      const p = await tx.punch.create({
        data: {
          employeeId: ts.employeeId,
          timesheetId,
          punchType,
          punchTime: punchDate,
          roundedTime,
          source: "MANUAL",
          stateBefore: "OUT",
          stateAfter: punchType === "CLOCK_IN" ? "WORK" : "OUT",
          isApproved: true,
          approvedById: actorId,
          approvedAt: new Date(),
          note: reason,
        },
      });
      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "MANUAL_PUNCH_ADDED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: { after: { punchType, punchTime, reason, source: "MANUAL" } },
      });
      return p;
    });

    await rebuildSegments(timesheetId, ruleSet);
    revalidatePath("/payroll/timecards");
  }
);

// ─── Add a payroll-entered leave entry to a timesheet day ────────────────────

export const addPayrollLeaveEntry = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { timesheetId, date, leaveTypeId, durationMinutes, note } =
      payrollLeaveEntrySchema.parse(input);

    // Verify timesheet is editable
    const ts = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
    });

    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("Cannot modify a locked or approved timesheet.");
    }

    const leaveDate = new Date(date + "T00:00:00.000Z");

    const leaveRequest = await db.$transaction(async (tx) => {
      const req = await tx.leaveRequest.create({
        data: {
          employeeId: ts.employeeId,
          leaveTypeId,
          status: "APPROVED",
          startDate: leaveDate,
          endDate: leaveDate,
          durationMinutes,
          note: note ?? null,
          submittedAt: new Date(),
          reviewedAt: new Date(),
          reviewedById: actorId,
        },
      });

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "PAYROLL_LEAVE_ADDED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: {
          after: { leaveRequestId: req.id, leaveTypeId, date, durationMinutes },
        },
      });

      return req;
    });

    await syncLeaveSegments(leaveRequest.id);
    revalidatePath("/payroll/timecards");
  }
);

// ─── Remove a payroll-entered leave entry ────────────────────────────────────

export const removePayrollLeaveEntry = withRBAC(
  "PAY_PERIOD_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { leaveRequestId } = (input as { leaveRequestId: string });

    if (!leaveRequestId) throw new Error("leaveRequestId is required.");

    // Find the leave request and verify the timesheet is editable
    const request = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leaveRequestId },
      include: {
        segments: { select: { timesheetId: true }, take: 1 },
      },
    });

    const timesheetId = request.segments[0]?.timesheetId;
    if (timesheetId) {
      const ts = await db.timesheet.findUnique({ where: { id: timesheetId } });
      if (ts && (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED")) {
        throw new Error("Cannot modify a locked or approved timesheet.");
      }
    }

    await db.leaveRequest.update({
      where: { id: leaveRequestId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await writeAuditLog({
      tenantId: tenantId!,
      actorId,
      action: "PAYROLL_LEAVE_REMOVED",
      entityType: "TIMESHEET",
      entityId: timesheetId ?? leaveRequestId,
      changes: { before: { leaveRequestId, status: request.status } },
    });

    await syncLeaveSegments(leaveRequestId);
    revalidatePath("/payroll/timecards");
  }
);

// ─── Save or update a timesheet note for a specific date ─────────────────────

const saveTimesheetNoteSchema = z.object({
  timesheetId: z.string(),
  noteDate: z.string(), // yyyy-MM-dd
  note: z.string(),
});

export const saveTimesheetNote = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: z.infer<typeof saveTimesheetNoteSchema>) => {
    const { timesheetId, noteDate, note } = saveTimesheetNoteSchema.parse(input);
    const createdById = ctx.employeeId;

    if (!note.trim()) {
      // Delete the note if empty
      await db.timesheetNote.deleteMany({
        where: {
          timesheetId,
          noteDate: new Date(noteDate + "T00:00:00Z"),
        },
      });
    } else {
      await db.timesheetNote.upsert({
        where: {
          timesheetId_noteDate: {
            timesheetId,
            noteDate: new Date(noteDate + "T00:00:00Z"),
          },
        },
        create: {
          timesheetId,
          noteDate: new Date(noteDate + "T00:00:00Z"),
          note: note.trim(),
          createdById,
        },
        update: {
          note: note.trim(),
        },
      });
    }

    revalidatePath("/payroll/timecards");
  }
);
