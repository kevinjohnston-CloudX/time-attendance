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
  payrollLeaveEntrySchema,
} from "@/lib/validators/timecard-entry.schema";
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
    const { timesheetId, inTime, outTime, reason } =
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
