"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";

export const getReasonCodes = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];
    return db.reasonCode.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
      include: { _count: { select: { dayReasons: true } } },
    });
  }
);

const createReasonCodeSchema = z.object({
  code: z.string().min(1).max(20).toUpperCase(),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export const createReasonCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: unknown) => {
    const { code, label, color } = createReasonCodeSchema.parse(input);
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");

    const existing = await db.reasonCode.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (existing) throw new Error("A reason code with that code already exists.");

    await db.reasonCode.create({ data: { tenantId, code, label, color: color ?? null } });
    return { success: true };
  }
);

const updateReasonCodeSchema = z.object({
  reasonCodeId: z.string().min(1),
  code: z.string().min(1).max(20).toUpperCase(),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  isActive: z.boolean(),
});

export const updateReasonCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: unknown) => {
    const { reasonCodeId, code, label, color, isActive } = updateReasonCodeSchema.parse(input);
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");

    // Found inside the caller's company first; it used to update by id alone.
    const own = await db.reasonCode.findFirst({ where: { id: reasonCodeId, tenantId }, select: { id: true } });
    if (!own) throw new Error("NOT_FOUND");

    const conflict = await db.reasonCode.findFirst({
      where: { tenantId, code, NOT: { id: own.id } },
    });
    if (conflict) throw new Error("Another reason code with that code already exists.");

    await db.reasonCode.update({
      where: { id: own.id },
      data: { code, label, color: color ?? null, isActive },
    });
    return { success: true };
  }
);

export const deleteReasonCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (ctx, input: unknown) => {
    const { reasonCodeId } = z.object({ reasonCodeId: z.string().min(1) }).parse(input);
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    // It deleted by id alone, from any company. A code already on a timecard
    // day cannot go (the database refuses), so that is said in words instead.
    const own = await db.reasonCode.findFirst({
      where: { id: reasonCodeId, tenantId },
      select: { id: true, _count: { select: { dayReasons: true } } },
    });
    if (!own) throw new Error("NOT_FOUND");
    const used = own._count.dayReasons;
    if (used > 0) {
      throw new Error(
        `This code is on ${used.toLocaleString()} timecard ${used === 1 ? "day" : "days"}, so it cannot be deleted. Set it to inactive instead.`,
      );
    }
    await db.reasonCode.deleteMany({ where: { id: own.id, tenantId } });
    return { success: true };
  }
);

// ─── Set (or clear) the reason code annotation for any timecard day ───────────
// Writes to timesheet_day_reasons — never touches work segments.

const setDayReasonCodeSchema = z.object({
  timesheetId: z.string(),
  segmentDate: z.string(), // "YYYY-MM-DD"
  reasonCodeId: z.string().nullable(),
});

export const setDayReasonCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: z.infer<typeof setDayReasonCodeSchema>) => {
    const { timesheetId, segmentDate, reasonCodeId } = setDayReasonCodeSchema.parse(input);
    const date = new Date(segmentDate + "T00:00:00.000Z");

    if (!reasonCodeId) {
      await db.timesheetDayReason.deleteMany({ where: { timesheetId, segmentDate: date } });
    } else {
      await db.timesheetDayReason.upsert({
        where: { timesheetId_segmentDate: { timesheetId, segmentDate: date } },
        create: { timesheetId, segmentDate: date, reasonCodeId },
        update: { reasonCodeId },
      });
    }

    return { success: true };
  }
);
