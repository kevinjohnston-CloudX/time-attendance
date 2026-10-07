"use server";

import { assertEditable, timesheetInScope } from "@/lib/rbac/scope";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { TIMECARD_EDITORS, TIMECARD_EDITORS_COMPANY } from "@/lib/rbac/permissions";
import { writeAuditLog } from "@/lib/audit/logger";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { timesheetIdSchema, type TimesheetIdInput } from "@/lib/validators/timesheet.schema";
import { z } from "zod";

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
  TIMECARD_EDITORS,
  async (ctx, input: TimesheetIdInput): Promise<void> => {
    const { timesheetId } = timesheetIdSchema.parse(input);
    await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);

    const timesheet = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      include: { employee: { include: { ruleSet: true } } },
    });

    await rebuildSegments(timesheet.id, timesheet.employee.ruleSet);
    revalidatePath("/payroll/timecards");
  }
);

// ─── unlockTimesheet / lockTimesheet ─────────────────────────────────────────
// One person's timecard, while its pay period stays locked: unlock to correct
// it, lock again when done. Unlocking the whole period is reopenPayPeriod.

const unlockTimesheetSchema = z.object({
  timesheetId: z.string().cuid(),
  reason: z.string().trim().min(1, "Give a reason for unlocking this timecard").max(500),
});

export const unlockTimesheet = withRBAC(
  "PAYROLL_RUN",
  async (ctx, input: unknown): Promise<{ success: true }> => {
    const { timesheetId, reason } = unlockTimesheetSchema.parse(input);
    const sheet = await timesheetInScope(ctx, timesheetId, "PAYROLL_RUN");
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't unlock your own timecard");
    if (sheet.status !== "LOCKED") throw new Error("This timecard is not locked.");

    await db.$transaction(async (tx) => {
      await tx.timesheet.update({ where: { id: timesheetId }, data: { status: "OPEN", lockedAt: null } });
      await writeAuditLog({
        tenantId: ctx.tenantId,
        actorId: ctx.employeeId,
        action: "TIMESHEET_UNLOCKED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: { before: { status: "LOCKED" }, after: { status: "OPEN", reason } },
      });
    });

    revalidatePath("/payroll/timecards");
    revalidatePath("/payroll/pay-periods");
    return { success: true };
  }
);

export const lockTimesheet = withRBAC(
  "PAYROLL_RUN",
  async (ctx, input: TimesheetIdInput): Promise<{ success: true }> => {
    const { timesheetId } = timesheetIdSchema.parse(input);
    const sheet = await timesheetInScope(ctx, timesheetId, "PAYROLL_RUN");
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't lock your own timecard");
    if (sheet.status === "LOCKED") throw new Error("This timecard is already locked.");

    // Only to re-lock a card inside a locked period; an open period is locked as a whole.
    const { payPeriod } = await db.timesheet.findUniqueOrThrow({
      where: { id: timesheetId },
      select: { payPeriod: { select: { status: true } } },
    });
    if (payPeriod.status !== "LOCKED") {
      throw new Error("Lock the pay period to lock its timecards. Single timecards are only locked again inside a locked pay period.");
    }

    await db.$transaction(async (tx) => {
      await tx.timesheet.update({ where: { id: timesheetId }, data: { status: "LOCKED", lockedAt: new Date() } });
      await writeAuditLog({
        tenantId: ctx.tenantId,
        actorId: ctx.employeeId,
        action: "TIMESHEET_LOCKED",
        entityType: "TIMESHEET",
        entityId: timesheetId,
        changes: { before: { status: sheet.status }, after: { status: "LOCKED" } },
      });
    });

    revalidatePath("/payroll/timecards");
    revalidatePath("/payroll/pay-periods");
    return { success: true };
  }
);

// ─── Waiver notes and wording ─────────────────────────────────────────────────

/** "Mon, Sep 30, 2026" for a yyyy-MM-dd day. */
function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(day + "T00:00:00Z"));
}

const ORDINALS = ["First", "Second", "Third", "Fourth"];

/** A premium by its row in the rule set: "Second meal premium". */
function premiumName(rowIndex: number | null): string {
  if (rowIndex == null) return "Meal premium";
  return rowIndex < ORDINALS.length ? `${ORDINALS[rowIndex]} meal premium` : `Meal premium ${rowIndex + 1}`;
}

async function actorName(employeeId: string | null | undefined): Promise<string> {
  if (!employeeId) return "System";
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { user: { select: { name: true } }, employeeCode: true } });
  return e?.user?.name ?? e?.employeeCode ?? "Unknown";
}

/**
 * A note on the waived day, among the day's other notes on the timecard: HR
 * reads the day's notes, and a waiver used to leave nothing on the day it was
 * for (the audit log listed it under the day it was clicked).
 */
function waiverNote(timesheetId: string, noteDate: Date, note: string, createdById: string | null | undefined, createdByName: string) {
  return { timesheetId, noteDate, note, createdById: createdById ?? "system", createdByName };
}

// ─── toggleMealWaiver ─────────────────────────────────────────────────────────

const mealWaiverSchema = z.object({
  timesheetId: z.string().cuid(),
  segmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd"),
});

export const toggleMealWaiver = withRBAC(
  TIMECARD_EDITORS,
  async (ctx, input: unknown): Promise<{ success: boolean; waived: boolean }> => {
    const { employeeId: actorId, tenantId } = ctx;
    const { timesheetId, segmentDate } = mealWaiverSchema.parse(input);
    const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't approve or change your own timesheet");
    assertEditable(sheet.status);

    const dateObj = new Date(segmentDate + "T00:00:00.000Z");

    const existing = await db.mealWaiver.findUnique({
      where: { timesheetId_segmentDate: { timesheetId, segmentDate: dateObj } },
    });
    const by = await actorName(actorId);

    if (existing) {
      await db.$transaction(async (tx) => {
        await tx.mealWaiver.delete({ where: { id: existing.id } });
        await tx.timesheetNote.create({ data: waiverNote(timesheetId, dateObj, "Meal waiver removed: the meal is deducted again", actorId, by) });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_WAIVER_REMOVED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { fields: [{ field: "Date", before: dayLabel(segmentDate), after: dayLabel(segmentDate) }, { field: "Meal", before: "Waived", after: "Deducted" }], segmentDate },
        });
      });
    } else {
      await db.$transaction(async (tx) => {
        await tx.mealWaiver.create({
          data: { timesheetId, segmentDate: dateObj, createdById: actorId },
        });
        await tx.timesheetNote.create({ data: waiverNote(timesheetId, dateObj, "Meal waived: no meal deducted", actorId, by) });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_WAIVER_ADDED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: { fields: [{ field: "Date", before: dayLabel(segmentDate), after: dayLabel(segmentDate) }, { field: "Meal", before: "Deducted", after: "Waived" }], segmentDate },
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
  TIMECARD_EDITORS,
  async (ctx, input: unknown): Promise<{ success: boolean; waived: boolean }> => {
    const { employeeId: actorId, tenantId } = ctx;
    const { timesheetId, segmentDate, segmentStart } = mealPremiumWaiverSchema.parse(input);
    const sheet = await timesheetInScope(ctx, timesheetId, TIMECARD_EDITORS_COMPANY);
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't approve or change your own timesheet");
    assertEditable(sheet.status);

    const dateObj = new Date(segmentDate + "T00:00:00.000Z");
    const startObj = new Date(segmentStart);

    // Which of the day's premiums this is. A waiver is kept against the day
    // and the premium row, so a later change to the day's punches, which
    // moves the premium's start time, does not undo it.
    // A premium line made before rows were recorded has none; its waiver is
    // matched on the start time until a recalculation records the row.
    const premiumLine = await db.workSegment.findFirst({
      where: { timesheetId, segmentType: "MEAL_PREMIUM", startTime: startObj },
      select: { premiumRow: true },
    });
    const rowIndex = premiumLine?.premiumRow ?? null;

    // Removing comes from a waived line, which carries the waiver's own start;
    // a premium line carries the premium's, which matches its row.
    const existing = await db.mealPremiumWaiver.findFirst({
      where: {
        timesheetId,
        OR: [{ segmentStart: startObj }, ...(rowIndex != null ? [{ segmentDate: dateObj, rowIndex }] : [])],
      },
    });
    const by = await actorName(actorId);

    if (existing) {
      const name = premiumName(existing.rowIndex);
      await db.$transaction(async (tx) => {
        await tx.mealPremiumWaiver.delete({ where: { id: existing.id } });
        await tx.timesheetNote.create({ data: waiverNote(timesheetId, dateObj, `${name} waiver removed: the premium is paid`, actorId, by) });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_PREMIUM_WAIVER_REMOVED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: {
            fields: [{ field: "Date", before: dayLabel(segmentDate), after: dayLabel(segmentDate) }, { field: name, before: "Waived", after: "Paid" }],
            segmentDate,
            segmentStart: existing.segmentStart.toISOString(),
            rowIndex: existing.rowIndex,
          },
        });
      });
    } else {
      const name = premiumName(rowIndex);
      await db.$transaction(async (tx) => {
        await tx.mealPremiumWaiver.create({
          data: { timesheetId, segmentDate: dateObj, segmentStart: startObj, rowIndex, createdById: actorId },
        });
        await tx.timesheetNote.create({ data: waiverNote(timesheetId, dateObj, `${name} waived`, actorId, by) });
        await writeAuditLog({
          tenantId,
          actorId,
          action: "MEAL_PREMIUM_WAIVER_ADDED",
          entityType: "TIMESHEET",
          entityId: timesheetId,
          changes: {
            fields: [{ field: "Date", before: dayLabel(segmentDate), after: dayLabel(segmentDate) }, { field: name, before: "Paid", after: "Waived" }],
            segmentDate,
            segmentStart,
            rowIndex,
          },
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
  async (ctx, input: TimesheetIdInput): Promise<{ success: boolean }> => {
    const { employeeId: actorId, tenantId } = ctx;
    const { timesheetId } = timesheetIdSchema.parse(input);
    const sheet = await timesheetInScope(ctx, timesheetId, "TIMESHEET_APPROVE_ANY");
    if (sheet.employeeId === ctx.employeeId) throw new Error("You can't approve or change your own timesheet");

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

    revalidatePath("/payroll/timecards");

    return { success: true };
  }
);
