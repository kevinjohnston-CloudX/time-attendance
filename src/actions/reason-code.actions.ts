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
    const tenantId = ctx.tenantId!;

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
    const tenantId = ctx.tenantId!;

    const conflict = await db.reasonCode.findFirst({
      where: { tenantId, code, NOT: { id: reasonCodeId } },
    });
    if (conflict) throw new Error("Another reason code with that code already exists.");

    await db.reasonCode.update({
      where: { id: reasonCodeId },
      data: { code, label, color: color ?? null, isActive },
    });
    return { success: true };
  }
);

export const deleteReasonCode = withRBAC(
  "PAY_PERIOD_MANAGE",
  async (_ctx, input: unknown) => {
    const { reasonCodeId } = z.object({ reasonCodeId: z.string().min(1) }).parse(input);
    await db.reasonCode.delete({ where: { id: reasonCodeId } });
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
