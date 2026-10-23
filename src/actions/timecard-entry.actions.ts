"use server";

import { assertActiveForChange, assertEditable, assertNotSenior, employeeScope, NotFoundError, timesheetInScope } from "@/lib/rbac/scope";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { TIMECARD_EDITORS, TIMECARD_EDITORS_COMPANY } from "@/lib/rbac/permissions";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";
import { computeRoundedTime, MAX_OVERNIGHT_MS, snapToLocalTime } from "@/lib/utils/date";
import {
  manualPunchPairSchema,
  singleManualPunchSchema,
  payrollLeaveEntrySchema,
} from "@/lib/validators/timecard-entry.schema";
import { z } from "zod";
import type { LeaveType } from "@prisma/client";
import { personTimeZone } from "@/lib/utils/person-time-zone";
import { placeEnteredHours } from "@/lib/entered-hours";

// ─── Get leave types for timecard entry modal ─────────────────────────────────

export const getLeaveTypesForTimecard = withRBAC(
  TIMECARD_EDITORS,
  async ({ tenantId }): Promise<LeaveType[]> => {
    return db.leaveType.findMany({
      where: { tenantId: tenantId!, isActive: true },
      orderBy: { name: "asc" },
    });
  }
);

// ─── Add a manual IN/OUT punch pair to a timesheet day ───────────────────────

export const addManualPunchPair = withRBAC(
  // Supervisors too, for their own team's timecards: the scope check in
  // each action keeps them to their direct reports and off their own.
  TIMECARD_EDITORS,
  async (ctx, input: unknown) => {
    const { timesheetId, date: entryDate, inTime, outTime, reason, payCodeId } =
      manualPunchPairSchema.parse(input);
    const { employeeId: actorId, tenantId } = ctx;
    // Only a timecard in the caller's company, and never their own.
    const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");

    const inDate = new Date(inTime);
    const outDate = new Date(outTime);

    if (outDate <= inDate) {
      throw new Error("The out time must be after the in time.");
    }

    // Load timesheet to verify editability
    const ts = await db.timesheet.findUniqueOrThrow({
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

    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("This timecard is locked or approved by payroll, so it can't be changed. Unlock it first, then make the correction.");
    }

    const { ruleSet, shift } = ts.employee;
    const tz = personTimeZone(ts.employee, "UTC");
    // A pair past midnight is the odd late evening (7:00 PM to 12:30 AM); one
    // longer than 16 hours is an AM/PM slip, not a shift.
    const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
    if (localDay(inDate) !== localDay(outDate) && outDate.getTime() - inDate.getTime() > MAX_OVERNIGHT_MS) {
      throw new Error("A shift past midnight can be up to 16 hours. Check the AM and PM.");
    }
    const roundedIn = computeRoundedTime(inDate, "CLOCK_IN", ruleSet, shift, tz);
    const roundedOut = computeRoundedTime(outDate, "CLOCK_OUT", ruleSet, shift, tz);

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
    // Fall back to the rule set's default pay code if no marker exists.
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
      effectivePayCodeId = absentMarker?.payCodeId ?? ruleSet.defaultPayCodeId ?? null;
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
  // Supervisors too, for their own team's timecards: the scope check in
  // each action keeps them to their direct reports and off their own.
  TIMECARD_EDITORS,
  async (ctx, input: unknown) => {
    const { timesheetId, punchType, punchTime, reason } =
      singleManualPunchSchema.parse(input);
    await saveManualPunches(ctx, timesheetId, [{ punchType, punchTime, reason }]);
  }
);

/**
 * A day's new punches from the timecard, saved together: one transaction and
 * one recalculation, under the same rules as one punch at a time. Saved one
 * request each, all at once, the clock in's recalculation could run before
 * the clock out was in and see a missed punch, leaving the system's 11:59 PM
 * clock out behind (Stephanie Resendiz, 10/19).
 */
export const addManualPunches = withRBAC(
  TIMECARD_EDITORS,
  async (ctx, input: unknown) => {
    const { timesheetId, punches } = z.object({
      timesheetId: z.string().min(1),
      punches: z.array(singleManualPunchSchema.omit({ timesheetId: true })).min(1).max(20),
    }).parse(input);
    await saveManualPunches(ctx, timesheetId, punches);
  }
);

async function saveManualPunches(
  ctx: Parameters<typeof timesheetInScope>[0],
  timesheetId: string,
  punches: { punchType: "CLOCK_IN" | "CLOCK_OUT"; punchTime: string; reason?: string }[],
): Promise<void> {
  const { employeeId: actorId, tenantId } = ctx;
  // Only a timecard in the caller's company, and never their own.
  const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
  if (sheet.employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");

  const ts = await db.timesheet.findUniqueOrThrow({
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

  if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
    throw new Error("This timecard is locked or approved by payroll, so it can't be changed. Unlock it first, then make the correction.");
  }

  const { ruleSet, shift } = ts.employee;
  const rows: { punchType: "CLOCK_IN" | "CLOCK_OUT"; punchTime: string; reason?: string; punchDate: Date; roundedTime: Date; inheritedPayCodeId: string | null }[] = [];
  for (const { punchType, punchTime, reason } of punches) {
    const punchDate = new Date(punchTime);
    const roundedTime = computeRoundedTime(punchDate, punchType, ruleSet, shift, personTimeZone(ts.employee, "UTC"));

    // Reject if another approved punch, or another one saved with it,
    // already lands at the exact same rounded time
    const conflicting = rows.some((r) => r.roundedTime.getTime() === roundedTime.getTime()) || await db.punch.findFirst({
      where: { timesheetId, isApproved: true, correctedById: null, roundedTime },
    });
    if (conflicting) {
      throw new Error("A punch already exists at this time.");
    }

    // For CLOCK_IN punches, inherit pay code from an absent-day marker if one exists,
    // falling back to the rule set's default pay code.
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
      inheritedPayCodeId = absentMarker?.payCodeId ?? ruleSet.defaultPayCodeId ?? null;
    }
    rows.push({ punchType, punchTime, reason, punchDate, roundedTime, inheritedPayCodeId });
  }

  await db.$transaction(async (tx) => {
    for (const { punchType, punchTime, reason, punchDate, roundedTime, inheritedPayCodeId } of rows) {
      await tx.punch.create({
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
    }
  });

  await rebuildSegments(timesheetId, ruleSet);
  revalidatePath("/payroll/timecards");
}

// ─── Add a payroll-entered leave entry to a timesheet day ────────────────────

export const addPayrollLeaveEntry = withRBAC(
  TIMECARD_EDITORS,
  async (ctx, input: unknown) => {
    const { timesheetId, date, leaveTypeId, durationMinutes, note } =
      payrollLeaveEntrySchema.parse(input);
    const { employeeId: actorId, tenantId } = ctx;
    // Only a timecard in the caller's company, and never their own.
    const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");

    // Verify timesheet is editable
    const ts = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
    });

    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("This timecard is locked or approved by payroll, so it can't be changed. Unlock it first, then make the correction.");
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
  TIMECARD_EDITORS,
  async (ctx, input: unknown) => {
    const { employeeId: actorId, tenantId } = ctx;
    const { leaveRequestId } = (input as { leaveRequestId: string });

    if (!leaveRequestId) throw new Error("Pick the leave request to change.");
    // Only leave of someone in the caller's company, and never their own.
    const inScope = await db.leaveRequest.findFirst({
      where: { id: leaveRequestId, employee: await employeeScope(ctx, TIMECARD_EDITORS_COMPANY) },
      select: { employeeId: true, employee: { select: { isActive: true } } },
    });
    if (!inScope) throw new NotFoundError("This leave request isn't available to you. It may have been removed, or be outside the sites you can see. Reload the page and try again.");
    assertActiveForChange(inScope.employee.isActive);
    if (inScope.employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");
    await assertNotSenior(ctx, inScope.employeeId, TIMECARD_EDITORS_COMPANY);

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
        throw new Error("This timecard is locked or approved by payroll, so it can't be changed. Unlock it first, then make the correction.");
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
  async (ctx, input: { punchIds: string[] }) => {
    const { employeeId: actorId, tenantId } = ctx;
    const { punchIds } = input;
    if (!punchIds.length) throw new Error("No punch IDs provided.");

    // Only punches in the caller's company, all on one timecard, never their own.
    const punches = await db.punch.findMany({
      where: { id: { in: punchIds }, employee: await employeeScope(ctx, TIMECARD_EDITORS_COMPANY) },
      include: { employee: { include: { ruleSet: true } } },
    });

    if (punches.length !== new Set(punchIds).size) throw new NotFoundError("These punches isn't available to you. It may have been removed, or be outside the sites you can see. Reload the page and try again.");
    assertActiveForChange(punches[0].employee.isActive);
    if (new Set(punches.map((p) => p.timesheetId)).size !== 1) throw new Error("These punches are on different timecards. Change them one timecard at a time.");
    if (punches[0].employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");
    await assertNotSenior(ctx, punches[0].employeeId, TIMECARD_EDITORS_COMPANY);
    const timesheetId = punches[0].timesheetId!;

    const ts = await db.timesheet.findUniqueOrThrow({ where: { id: timesheetId } });
    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("This timecard is locked or approved by payroll, so it can't be changed. Unlock it first, then make the correction.");
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
  TIMECARD_EDITORS,
  async (ctx, input: z.infer<typeof saveTimesheetNoteSchema>) => {
    const { timesheetId, noteDate, note } = saveTimesheetNoteSchema.parse(input);
    if (!note.trim()) return;
    await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);

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

// ─── Add manual hours to a punchless day ─────────────────────────────────────

const LEAVE_BUCKETS = new Set(["PTO", "SICK", "FMLA", "BEREAVEMENT", "JURY_DUTY", "MILITARY", "UNPAID"]);

export const addManualHoursEntry = withRBAC(
  // Supervisors too, for their own team's timecards: the scope check in
  // each action keeps them to their direct reports and off their own.
  TIMECARD_EDITORS,
  async (ctx, input: unknown) => {
    const { timesheetId, date, hours, payCodeId, note } = z.object({
      timesheetId: z.string(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      hours: z.number().min(0).max(24),
      payCodeId: z.string().optional(),
      note: z.string().optional(),
    }).parse(input);
    const { employeeId: actorId, tenantId } = ctx;
    // Only a timecard in the caller's company, and never their own.
    const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't change your own timecard");

    // Before either path below, the 0 hour one included: a locked or payroll
    // approved timecard takes no new entries.
    assertEditable(sheet.status);

    const minutes = Math.round(hours * 60);

    // 0-hour entry: create a 0-duration absent-day marker so the pay code
    // appears on the timecard row without contributing any hours.
    // The normal punch/leave-request paths can't handle 0 duration.
    if (minutes === 0) {
      const [ny, nm, nd] = date.split("-").map(Number);
      const segDate = new Date(Date.UTC(ny, nm - 1, nd));

      const existing = await db.workSegment.findFirst({
        where: { timesheetId, segmentDate: segDate, durationMinutes: 0, segmentType: "LEAVE" },
      });
      if (existing) {
        await db.workSegment.update({
          where: { id: existing.id },
          data: { payCodeId: payCodeId ?? null },
        });
      } else {
        await db.workSegment.create({
          data: {
            timesheetId,
            segmentType: "LEAVE",
            startTime: segDate,
            endTime: segDate,
            durationMinutes: 0,
            segmentDate: segDate,
            isPaid: false,
            payBucket: "REG",
            payCodeId: payCodeId ?? null,
          },
        });
      }

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "MANUAL_PUNCH_ADDED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: { after: { date, hours: 0, payCodeId: payCodeId ?? null, source: "MANUAL_HOURS_PAY_CODE_ONLY" } },
      });

      revalidatePath("/payroll/timecards");
      return;
    }

    const ts = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true, site: true } } },
    });

    if (ts.status === "LOCKED" || ts.status === "PAYROLL_APPROVED") {
      throw new Error("This timecard is locked or approved by payroll, so it can't be changed. Unlock it first, then make the correction.");
    }

    // Determine if this pay code maps to a leave type.
    // If so, use the leave-request path (no punches, no meal deduction).
    let leaveTypeId: string | null = null;
    if (payCodeId && tenantId) {
      const payCode = await db.payCode.findUnique({
        where: { id: payCodeId },
        select: { payBucket: true },
      });
      // Try explicit payCode → leaveType link first
      let leaveType = await db.leaveType.findFirst({
        where: { payCodeId, isActive: true, tenantId },
      });
      // Fall back: payBucket is a leave bucket → find matching leaveType by category
      if (!leaveType && payCode?.payBucket && LEAVE_BUCKETS.has(payCode.payBucket)) {
        leaveType = await db.leaveType.findFirst({
          where: { category: payCode.payBucket as never, isActive: true, tenantId },
        });
      }
      if (leaveType) leaveTypeId = leaveType.id;
    }

    if (leaveTypeId) {
      // Leave-type pay code: create a leave request and sync leave segments.
      // This bypasses punches entirely, so no meal deduction, no OT rules,
      // and no IN/OUT times appear on the timecard.
      const leaveDate = new Date(date + "T00:00:00.000Z");

      const leaveRequest = await db.$transaction(async (tx) => {
        const req = await tx.leaveRequest.create({
          data: {
            employeeId: ts.employeeId,
            leaveTypeId,
            status: "POSTED",
            startDate: leaveDate,
            endDate: leaveDate,
            durationMinutes: minutes,
            note: note ?? null,
            submittedAt: new Date(),
            reviewedAt: new Date(),
            reviewedById: actorId,
            postedAt: new Date(),
          },
        });

        await writeAuditLog({
          tenantId: tenantId!,
          actorId,
          action: "MANUAL_PUNCH_ADDED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { after: { date, hours, leaveTypeId, source: "MANUAL_HOURS_LEAVE" } },
        });

        return req;
      });

      await syncLeaveSegments(leaveRequest.id);

      // If the caller chose a specific pay code (e.g. PTO CARRYOVER vs PTO),
      // override what the policy resolver picked for the resulting LEAVE segments.
      if (payCodeId) {
        await db.workSegment.updateMany({
          where: { leaveRequestId: leaveRequest.id },
          data: { payCodeId },
        });
      }
    } else {
      // Non-leave pay code: a punch pair that only carries the hours, from
      // local midnight, or from where the day's entered hours end
      // (placeEnteredHours). The same code again is refused.
      const tz = personTimeZone(ts.employee, "UTC");
      const dayStart = snapToLocalTime("00:00", date, tz);
      const nextDay = new Date(dayStart.getTime() + 86_400_000);
      const entered = await db.punch.findMany({
        where: { timesheetId, hoursOnly: true, isApproved: true, correctedById: null, punchTime: { gte: dayStart, lt: new Date(nextDay.getTime() + 86_400_000) } },
        orderBy: { punchTime: "asc" },
        select: { punchType: true, punchTime: true, payCodeId: true },
      });
      const defaultCode = ts.employee.ruleSet.defaultPayCodeId ?? null;
      const existing = entered.flatMap((p, i) => {
        if (p.punchType !== "CLOCK_IN" || p.punchTime >= nextDay) return [];
        const out = entered.slice(i + 1).find((q) => q.punchType === "CLOCK_OUT");
        return out ? [{ start: p.punchTime, end: out.punchTime, payCodeId: p.payCodeId ?? defaultCode }] : [];
      });
      const placed = placeEnteredHours(dayStart, minutes, payCodeId ?? defaultCode, existing);
      const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
      if ("refused" in placed) {
        if (placed.refused === "over-24h") throw new Error(`That would put more than 24 hours on ${dayLabel}.`);
        const code = placed.entry.payCodeId
          ? (await db.payCode.findUnique({ where: { id: placed.entry.payCodeId }, select: { label: true } }))?.label
          : null;
        const had = Math.round((placed.entry.end.getTime() - placed.entry.start.getTime()) / 36_000) / 100;
        throw new Error(`${dayLabel} already has ${had} hours entered${code ? ` as ${code}` : ""}. Change that entry instead of adding another.`);
      }
      const inDate = placed.start;
      const outDate = placed.end;

      await db.$transaction(async (tx) => {
        await tx.punch.create({
          data: {
            employeeId: ts.employeeId,
            timesheetId,
            punchType: "CLOCK_IN",
            punchTime: inDate,
            roundedTime: inDate,
            source: "MANUAL",
            stateBefore: "OUT",
            stateAfter: "WORK",
            isApproved: true,
            approvedById: actorId,
            approvedAt: new Date(),
            note: note ?? `Manual hours entry: ${hours}h`,
            payCodeId: payCodeId ?? null,
            hoursOnly: true,
          },
        });
        await tx.punch.create({
          data: {
            employeeId: ts.employeeId,
            timesheetId,
            punchType: "CLOCK_OUT",
            punchTime: outDate,
            roundedTime: outDate,
            source: "MANUAL",
            stateBefore: "WORK",
            stateAfter: "OUT",
            isApproved: true,
            approvedById: actorId,
            approvedAt: new Date(),
            note: note ?? `Manual hours entry: ${hours}h`,
            hoursOnly: true,
          },
        });
        await writeAuditLog({
          tenantId: tenantId!,
          actorId,
          action: "MANUAL_PUNCH_ADDED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { after: { date, hours, source: "MANUAL_HOURS" } },
        });
      });

      await rebuildSegments(timesheetId, ts.employee.ruleSet);
    }

    revalidatePath("/payroll/timecards");
  }
);
