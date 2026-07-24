"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";
import type { Shift } from "@prisma/client";

// ─── List shifts for tenant ──────────────────────────────────────────────────

export const getShifts = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [] as Shift[];

    return db.shift.findMany({
      where: { tenantId },
      orderBy: [{ startTime: "asc" }, { name: "asc" }],
    });
  }
);

// ─── Create a shift ──────────────────────────────────────────────────────────

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm");

const workDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .default([1, 2, 3, 4, 5]);

const optionalTimeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm").optional().or(z.literal("")).transform((v) => v || null);
const toleranceSchema = z.coerce.number().int().min(0).max(120).default(0);

const createShiftSchema = z.object({
  name: z.string().min(1).max(100),
  startTime: timeSchema,
  endTime: timeSchema,
  workDays: workDaysSchema,
  earlyInMinutes: toleranceSchema,
  lateInMinutes: toleranceSchema,
  earlyOutMinutes: toleranceSchema,
  lateOutMinutes: toleranceSchema,
  mealBreakStart: optionalTimeSchema,
  mealBreakEnd: optionalTimeSchema,
});

export const createShift = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { name, startTime, endTime, workDays, earlyInMinutes, lateInMinutes, earlyOutMinutes, lateOutMinutes, mealBreakStart, mealBreakEnd } = createShiftSchema.parse(input);
    const tenantId = ctx.tenantId!;

    const existing = await db.shift.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    if (existing) throw new Error(`A shift named "${name}" already exists.`);

    await db.shift.create({
      data: { tenantId, name, startTime, endTime, workDays, earlyInMinutes, lateInMinutes, earlyOutMinutes, lateOutMinutes, mealBreakStart, mealBreakEnd },
    });

    return { success: true };
  }
);

// ─── Update a shift ──────────────────────────────────────────────────────────

const updateShiftSchema = z.object({
  shiftId: z.string().min(1),
  name: z.string().min(1).max(100),
  startTime: timeSchema,
  endTime: timeSchema,
  workDays: workDaysSchema,
  earlyInMinutes: toleranceSchema,
  lateInMinutes: toleranceSchema,
  earlyOutMinutes: toleranceSchema,
  lateOutMinutes: toleranceSchema,
  mealBreakStart: optionalTimeSchema,
  mealBreakEnd: optionalTimeSchema,
  isActive: z.boolean(),
});

export const updateShift = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { shiftId, name, startTime, endTime, workDays, earlyInMinutes, lateInMinutes, earlyOutMinutes, lateOutMinutes, mealBreakStart, mealBreakEnd, isActive } = updateShiftSchema.parse(input);
    const tenantId = ctx.tenantId!;

    const conflict = await db.shift.findFirst({
      where: { tenantId, name, NOT: { id: shiftId } },
    });
    if (conflict) throw new Error(`Another shift named "${name}" already exists.`);

    await db.shift.update({
      where: { id: shiftId },
      data: { name, startTime, endTime, workDays, earlyInMinutes, lateInMinutes, earlyOutMinutes, lateOutMinutes, mealBreakStart, mealBreakEnd, isActive },
    });

    return { success: true };
  }
);

// ─── Delete a shift ──────────────────────────────────────────────────────────

export const deleteShift = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { shiftId } = z.object({ shiftId: z.string().min(1) }).parse(input);
    const tenantId = ctx.tenantId!;

    await db.shift.deleteMany({
      where: { id: shiftId, tenantId },
    });

    return { success: true };
  }
);
