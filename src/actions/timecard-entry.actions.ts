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
    const { timesheetId, date: entryDate, inTime, outTime, reason, payCodeId } =
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

    // If the user didn't pick a pay code, check for an existing absent-day marker
    // (created via the Code dropdown on a day with no punches). Inherit its pay code
    // so the deduction fires automatically when hours are added to that day.
    let effectivePayCodeId = payCodeId ?? null;
    if (!effectivePayCodeId) {
      const [ny, nm, nd] = entryDate.split("-").map(Number);
      const dayStart = new Date(Date.UTC(ny, nm - 1, nd));
      const dayEnd = new Date(Date.UTC(ny, nm - 1, nd + 1));
      const absentMarker = await db.workSegment.findFirst({
        where: {
          timesheetId,
          segmentType: "LEAVE",
          durationMinutes: 0,
          segmentDate: { gte: dayStart, lt: dayEnd },
          payCodeId: { not: null },
        },
        select: { payCodeId: true },
      });
      if (absentMarker?.payCodeId) {
        effectivePayCodeId = absentMarker.payCodeId;
      }
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
          payCodeId: effectivePayCodeId,
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

    // For CLOCK_IN punches, inherit pay code from an absent-day marker if one exists
    let inheritedPayCodeId: string | null = null;
    if (punchType === "CLOCK_IN") {
      const dayStart = new Date(Date.UTC(punchDate.getUTCFullYear(), punchDate.getUTCMonth(), punchDate.getUTCDate()));
      const dayEnd = new Date(Date.UTC(punchDate.getUTCFullYear(), punchDate.getUTCMonth(), punchDate.getUTCDate() + 1));
      const absentMarker = await db.workSegment.findFirst({
        where: {
          timesheetId,
          segmentType: "LEAVE",
          durationMinutes: 0,
          segmentDate: { gte: dayStart, lt: dayEnd },
          payCodeId: { not: null },
        },
        select: { payCodeId: true },
      });
      if (absentMarker?.payCodeId) inheritedPayCodeId = absentMarker.payCodeId;
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
          payCodeId: inheritedPayCodeId,
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

// ─── Delete a manually-added punch pair (HR Admin and above only) ─────────────

export const deleteManualPunchPair = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: { punchIds: string[] }) => {
    const { punchIds } = input;
    if (!punchIds.length) throw new Error("No punch IDs provided.");

    const punches = await db.punch.findMany({
      where: { id: { in: punchIds } },
      include: { employee: { include: { ruleSet: true } } },
    });

    if (!punches.length) throw new Error("Punches not found.");
    const timesheetId = punches[0].timesheetId!;

    const ts = await db.timesheet.findUniqueOrThrow({ where: { id: timesheetId } });
    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("Cannot modify a locked or approved timesheet.");
    }

    for (const punch of punches) {
      if (punch.source !== "MANUAL") {
        throw new Error("Only manually added punches can be deleted this way.");
      }
      if (punch.correctedById) {
        throw new Error("Punch has already been corrected or deleted.");
      }
    }

    await db.$transaction(async (tx) => {
      for (const punch of punches) {
        const tombstone = await tx.punch.create({
          data: {
            employeeId: punch.employeeId,
            timesheetId: punch.timesheetId,
            punchType: punch.punchType,
            punchTime: punch.punchTime,
            roundedTime: punch.roundedTime,
            source: "MANUAL",
            stateBefore: punch.stateBefore,
            stateAfter: punch.stateAfter,
            isApproved: false,
            approvedById: actorId,
            approvedAt: new Date(),
            note: "VOID: Manual entry deleted",
            correctsId: punch.id,
          },
        });
        await tx.punch.update({
          where: { id: punch.id },
          data: { correctedById: tombstone.id },
        });
      }

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "MANUAL_PUNCH_DELETED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: { before: { punchIds } },
      });
    });

    await rebuildSegments(timesheetId, punches[0].employee.ruleSet);
    revalidatePath("/payroll/timecards");
  }
);

// ─── Add a permanent timesheet note for a specific date ──────────────────────

const saveTimesheetNoteSchema = z.object({
  timesheetId: z.string(),
  noteDate: z.string(), // yyyy-MM-dd
  note: z.string(),
});

export const saveTimesheetNote = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: z.infer<typeof saveTimesheetNoteSchema>) => {
    const { timesheetId, noteDate, note } = saveTimesheetNoteSchema.parse(input);
    if (!note.trim()) return;

    const createdById = ctx.employeeId;

    const employee = await db.employee.findUnique({
      where: { id: createdById },
      select: { user: { select: { name: true } }, employeeCode: true },
    });
    const createdByName = employee?.user?.name ?? employee?.employeeCode ?? "Unknown";

    const [ny, nm, nd] = noteDate.split("-").map(Number);
    await db.timesheetNote.create({
      data: {
        timesheetId,
        noteDate: new Date(ny, nm - 1, nd), // local midnight avoids timezone shift
        note: note.trim(),
        createdById,
        createdByName,
      },
    });

    revalidatePath("/payroll/timecards");
  }
);
