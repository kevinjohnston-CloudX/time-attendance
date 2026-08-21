"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { reconcileLeaveDeductions, reconcileSalarySegmentDeduction } from "@/lib/engines/leave-deduction";
import { z } from "zod";

// ─── List pay codes for tenant ──────────────────────────────────────────────

export const getPayCodes = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];

    return db.payCode.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }
);

// ─── List ALL pay codes (including inactive) for admin management ────────────

export const getAllPayCodes = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];

    return db.payCode.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
  }
);

// ─── Create a pay code ───────────────────────────────────────────────────────

const createPayCodeSchema = z.object({
  code: z.number().int().min(0),
  label: z.string().min(1).max(100),
  expressCode: z.string().max(4).nullable().optional(),
  payBucket: z.string().nullable().optional(),
  countsTowardOt: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional(),
});

export const createPayCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: unknown) => {
    const { code, label, expressCode, payBucket, countsTowardOt, sortOrder } = createPayCodeSchema.parse(input);
    const tenantId = ctx.tenantId!;

    const existing = await db.payCode.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (existing) {
      throw new Error(`A pay code with numeric code ${code} already exists.`);
    }

    const nextOrder =
      sortOrder ??
      ((
        await db.payCode.aggregate({
          where: { tenantId },
          _max: { sortOrder: true },
        })
      )._max.sortOrder ?? -1) + 1;

    const created = await db.payCode.create({
      data: {
        tenantId,
        code,
        label,
        expressCode: expressCode?.trim().toUpperCase() || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payBucket: payBucket ? (payBucket as any) : null,
        countsTowardOt,
        sortOrder: nextOrder,
        isActive: true,
      },
    });

    // Backfill all existing REG WORK segments that have no pay code assigned.
    if (code === 0) {
      await db.workSegment.updateMany({
        where: {
          timesheet: { employee: { tenantId } },
          segmentType: "WORK",
          payBucket: "REG",
          payCodeId: null,
        },
        data: { payCodeId: created.id },
      });
    }

    return { success: true };
  }
);

// ─── Update a pay code ───────────────────────────────────────────────────────

const updatePayCodeSchema = z.object({
  payCodeId: z.string().min(1),
  code: z.number().int().min(0),
  label: z.string().min(1).max(100),
  expressCode: z.string().max(4).nullable().optional(),
  payBucket: z.string().nullable().optional(),
  countsTowardOt: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export const updatePayCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: unknown) => {
    const { payCodeId, code, label, expressCode, payBucket, countsTowardOt, sortOrder, isActive } =
      updatePayCodeSchema.parse(input);
    const tenantId = ctx.tenantId!;

    const conflict = await db.payCode.findFirst({
      where: { tenantId, code, NOT: { id: payCodeId } },
    });
    if (conflict) {
      throw new Error(`Another pay code already uses numeric code ${code}.`);
    }

    await db.payCode.update({
      where: { id: payCodeId },
      data: {
        code,
        label,
        expressCode: expressCode?.trim().toUpperCase() || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payBucket: payBucket ? (payBucket as any) : null,
        countsTowardOt,
        sortOrder,
        isActive,
      },
    });

    // Backfill existing REG WORK segments with no pay code when the Regular (code 0) is saved as active.
    if (code === 0 && isActive) {
      await db.workSegment.updateMany({
        where: {
          timesheet: { employee: { tenantId } },
          segmentType: "WORK",
          payBucket: "REG",
          payCodeId: null,
        },
        data: { payCodeId },
      });
    }

    return { success: true };
  }
);

// ─── Reorder pay codes ──────────────────────────────────────────────────────

export const reorderPayCodes = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: unknown) => {
    const { orderedIds } = z.object({ orderedIds: z.array(z.string()) }).parse(input);
    const tenantId = ctx.tenantId!;

    await Promise.all(
      orderedIds.map((id, index) =>
        db.payCode.updateMany({
          where: { id, tenantId },
          data: { sortOrder: index },
        })
      )
    );

    return { success: true };
  }
);

// ─── Set pay code on a work segment ─────────────────────────────────────────

const setSegmentPayCodeSchema = z.object({
  segmentId: z.string(),
  payCodeId: z.string().nullable(),
});

export const setSegmentPayCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: z.infer<typeof setSegmentPayCodeSchema>) => {
    const { segmentId, payCodeId } = setSegmentPayCodeSchema.parse(input);

    // Update the segment immediately so the UI reflects the change
    const segment = await db.workSegment.update({
      where: { id: segmentId },
      data: { payCodeId },
      select: { timesheetId: true, startTime: true },
    });

    // Write the pay code back to the originating CLOCK_IN punch so it survives
    // future rebuildSegments calls.
    const clockIn = await db.punch.findFirst({
      where: {
        timesheetId: segment.timesheetId,
        punchType: "CLOCK_IN",
        isApproved: true,
        correctedById: null,
        roundedTime: { lte: segment.startTime },
      },
      orderBy: { roundedTime: "desc" },
      select: { id: true },
    });
    if (clockIn) {
      await db.punch.update({
        where: { id: clockIn.id },
        data: { payCodeId: payCodeId ?? null },
      });
    }

    // Reconcile leave balance if a leave-type pay code was assigned or cleared.
    // If the segment has an originating CLOCK_IN punch, use the punch-based engine.
    // Otherwise (salary employees with no punches) use the direct segment path.
    const tenantId = ctx.tenantId;
    if (tenantId) {
      const timesheet = await db.timesheet.findUnique({
        where: { id: segment.timesheetId },
        select: { employeeId: true },
      });
      if (timesheet) {
        if (clockIn) {
          await reconcileLeaveDeductions(segment.timesheetId, timesheet.employeeId, tenantId, ctx.employeeId);
        } else {
          await reconcileSalarySegmentDeduction(segmentId, payCodeId, timesheet.employeeId, tenantId, ctx.employeeId);
        }
      }
    }

    return { success: true };
  }
);

// ─── Set pay bucket on a work segment ────────────────────────────────────────

const setSegmentPayBucketSchema = z.object({
  segmentId: z.string(),
  payBucket: z.string().nullable(),
});

export const setSegmentPayBucket = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: z.infer<typeof setSegmentPayBucketSchema>) => {
    const { segmentId, payBucket } = setSegmentPayBucketSchema.parse(input);

    await db.workSegment.update({
      where: { id: segmentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { payBucketOverride: payBucket ? (payBucket as any) : null },
    });

    return { success: true };
  }
);

// ─── Set pay bucket for an absent day (creates/deletes a 0-duration marker) ──

const setAbsentDayPayBucketSchema = z.object({
  timesheetId: z.string(),
  segmentDate: z.string(), // "YYYY-MM-DD"
  payBucket: z.string().nullable(),
});

export const setAbsentDayPayBucket = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: z.infer<typeof setAbsentDayPayBucketSchema>) => {
    const { timesheetId, segmentDate, payBucket } =
      setAbsentDayPayBucketSchema.parse(input);

    const date = new Date(segmentDate + "T00:00:00.000Z");

    if (!payBucket) {
      await db.workSegment.deleteMany({
        where: { timesheetId, segmentDate: date, durationMinutes: 0, segmentType: "LEAVE" },
      });
      return { success: true };
    }

    const existing = await db.workSegment.findFirst({
      where: { timesheetId, segmentDate: date, durationMinutes: 0, segmentType: "LEAVE" },
    });

    if (existing) {
      await db.workSegment.update({
        where: { id: existing.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { payBucket: payBucket as any },
      });
    } else {
      await db.workSegment.create({
        data: {
          timesheetId,
          segmentType: "LEAVE",
          startTime: date,
          endTime: date,
          durationMinutes: 0,
          segmentDate: date,
          isPaid: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payBucket: payBucket as any,
        },
      });
    }

    return { success: true };
  }
);

// ─── Set pay code for an absent day (creates/deletes a 0-duration marker) ────

const setAbsentDayPayCodeSchema = z.object({
  timesheetId: z.string(),
  segmentDate: z.string(), // "YYYY-MM-DD"
  payCodeId: z.string().nullable(),
});

export const setAbsentDayPayCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: z.infer<typeof setAbsentDayPayCodeSchema>) => {
    const { timesheetId, segmentDate, payCodeId } = setAbsentDayPayCodeSchema.parse(input);
    const date = new Date(segmentDate + "T00:00:00.000Z");

    const existing = await db.workSegment.findFirst({
      where: { timesheetId, segmentDate: date, durationMinutes: 0, segmentType: "LEAVE" },
    });

    if (!payCodeId) {
      if (existing) {
        // Keep the marker only if it carries a payBucket override; otherwise delete it
        // so the day reverts to absent.
        if (existing.payBucketOverride) {
          await db.workSegment.update({ where: { id: existing.id }, data: { payCodeId: null } });
        } else {
          await db.workSegment.delete({ where: { id: existing.id } });
        }
      }
      // Clear the pay code from any lone CLOCK_IN on this day (no WORK segments yet)
      const clearDayEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
      const loneClockIn = await db.punch.findFirst({
        where: {
          timesheetId,
          punchType: "CLOCK_IN",
          isApproved: true,
          correctedById: null,
          roundedTime: { gte: date, lt: clearDayEnd },
          payCodeId: { not: null },
        },
        select: { id: true },
      });
      if (loneClockIn) {
        await db.punch.update({ where: { id: loneClockIn.id }, data: { payCodeId: null } });
      }
      return { success: true };
    }

    if (existing) {
      await db.workSegment.update({ where: { id: existing.id }, data: { payCodeId } });
    } else {
      await db.workSegment.create({
        data: {
          timesheetId,
          segmentType: "LEAVE",
          startTime: date,
          endTime: date,
          durationMinutes: 0,
          segmentDate: date,
          isPaid: false,
          payBucket: "REG",
          payCodeId,
        },
      });
    }

    // Also propagate to any existing CLOCK_IN on this day that hasn't been paired yet
    // (handles the case where In time was entered before the pay code was set)
    const dayEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    const clockIn = await db.punch.findFirst({
      where: {
        timesheetId,
        punchType: "CLOCK_IN",
        isApproved: true,
        correctedById: null,
        roundedTime: { gte: date, lt: dayEnd },
      },
      select: { id: true },
    });
    if (clockIn) {
      await db.punch.update({
        where: { id: clockIn.id },
        data: { payCodeId },
      });
    }

    return { success: true };
  }
);
