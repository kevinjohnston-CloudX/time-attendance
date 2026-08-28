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
      orderBy: [{ number: "asc" }, { startTime: "asc" }, { name: "asc" }],
    });
  }
);

// ─── Meal config type (shared with UI) ───────────────────────────────────────

export type MealConfig = {
  deductionMethod: "HOURS_WORKED" | "TIME_PERIOD" | "SHIFT_PERIOD" | "ALLOWANCE_BY_HOURS" | "ALLOWANCE_BY_TIME";
  minMealMinutes: number;
  maxMealMinutes: number;
  reimbursementEnabled: boolean;
  reimbursementMinutes: number;
  dailyReimbursementLimitMinutes: number;
  doesNotAffectLongMealException: boolean;
  autoDeduct: boolean;
  noMealPunchBonusEnabled: boolean;
  noMealPunchBonusMinutes: number;
  noMealPunchBonusWorkHours: number;
  disableMinDeduction: boolean;
  useMealWindowForAutoDeduct: boolean;
  createMealDeductionEnabled: boolean;
  createMealDeductionHours: number;
  doNotSplitPunch: boolean;
  createMealBasis: "IN_OUT_PAIR" | "WORKING_HOURS";
  absoluteDeductionWindow: boolean;
  alwaysUseScheduledMeals: boolean;
  lateOutToMealEnabled: boolean;
  lateOutToMealHours: number;
  sendWaivedToPayCode: boolean;
  waivedPayCodeId: string;
  meals: Array<{ mealBeforeHours: number; workAtLeastHours: number; deductMinutes: number }>;
};

// ─── Break config type (shared with UI) ──────────────────────────────────────

export type BreakConfig = {
  applyPaidBreak: boolean;
  payMethod: "OFF_CLOCK_MINS" | "TIME_PERIOD" | "WORK_HOURS";
  punchOutWithinMinutes: number;
  payUpToMinutes: number;
};

// ─── Differential config type (shared with UI) ───────────────────────────────

export type DifferentialConfig = {
  applyDifferential: boolean;
  payMethod: "TIME_SEGMENT" | "SHIFT_PERIOD" | "GLOBAL_DIFFERENTIAL";
};

// ─── Day schedule row type (shared with UI) ───────────────────────────────────

export type DayScheduleRow = {
  day: number;          // 0=Sun … 6=Sat
  isWorkday: boolean;
  dayStart: string;     // "HH:mm" — punch eligibility window start (default "00:00")
  dayEnd: string;       // "HH:mm" — punch eligibility window end   (default "23:59")
  startTime: string | null;  // scheduled shift start for this day
  endTime: string | null;    // scheduled shift end for this day
  mealMinutes: number;       // scheduled meal break duration in minutes
};

const dayScheduleRowSchema = z.object({
  day: z.number().int().min(0).max(6),
  isWorkday: z.boolean(),
  dayStart: z.string().regex(/^\d{2}:\d{2}$/),
  dayEnd: z.string().regex(/^\d{2}:\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  mealMinutes: z.number().int().min(0),
});

/** Derive the shift-level startTime/endTime from the day schedule for engine use. */
function deriveShiftTimes(daySchedule: DayScheduleRow[]): { startTime: string; endTime: string } {
  const firstWorkday = daySchedule.find((d) => d.isWorkday && d.startTime && d.endTime);
  return {
    startTime: firstWorkday?.startTime ?? "08:00",
    endTime:   firstWorkday?.endTime   ?? "17:00",
  };
}

// ─── Shared schemas ───────────────────────────────────────────────────────────

const optionalTimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Must be HH:mm")
  .optional()
  .or(z.literal(""))
  .transform((v) => v || null);

const shiftPropertiesSchema = z.object({
  name: z.string().min(1).max(100),
  number: z.number().int().positive().nullable().optional(),
  workDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  mealBreakStart: optionalTimeSchema,
  mealBreakEnd: optionalTimeSchema,
  excludeFromSetup: z.boolean().default(false),
  shiftCycle: z.enum(["WEEKLY", "CUSTOM"]).default("WEEKLY"),
  cycleDays: z.number().int().min(1).default(7),
  cycleReferenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null)),
  shiftType: z.enum(["FIXED", "FLEXIBLE", "DYNAMIC"]).default("FIXED"),
  useScheduleGroupQualifiers: z.boolean().default(false),
  averageHours: z.number().min(0).max(24).nullable().optional(),
  daySchedule: z.array(dayScheduleRowSchema).length(7).optional(),
  mealConfig: z.any().optional(),
  breakConfig: z.any().optional(),
  differentialConfig: z.any().optional(),
});

// ─── Create a shift ──────────────────────────────────────────────────────────

export const createShift = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const parsed = shiftPropertiesSchema.parse(input);
    const tenantId = ctx.tenantId!;

    const existing = await db.shift.findUnique({
      where: { tenantId_name: { tenantId, name: parsed.name } },
    });
    if (existing) throw new Error(`A shift named "${parsed.name}" already exists.`);

    const { startTime, endTime } = parsed.daySchedule
      ? deriveShiftTimes(parsed.daySchedule)
      : { startTime: "08:00", endTime: "17:00" };

    // Derive workDays from daySchedule when provided
    const workDays = parsed.daySchedule
      ? parsed.daySchedule.filter((d) => d.isWorkday).map((d) => d.day)
      : parsed.workDays;

    await db.shift.create({
      data: {
        tenantId,
        name: parsed.name,
        number: parsed.number ?? null,
        startTime,
        endTime,
        workDays,
        mealBreakStart: parsed.mealBreakStart,
        mealBreakEnd: parsed.mealBreakEnd,
        excludeFromSetup: parsed.excludeFromSetup,
        shiftCycle: parsed.shiftCycle,
        cycleDays: parsed.cycleDays,
        cycleReferenceDate: parsed.cycleReferenceDate ?? null,
        shiftType: parsed.shiftType,
        useScheduleGroupQualifiers: parsed.useScheduleGroupQualifiers,
        averageHours: parsed.averageHours ?? null,
        daySchedule: parsed.daySchedule ?? undefined,
        mealConfig: parsed.mealConfig ?? undefined,
        breakConfig: parsed.breakConfig ?? undefined,
        differentialConfig: parsed.differentialConfig ?? undefined,
      },
    });

    return { success: true };
  }
);

// ─── Update a shift ──────────────────────────────────────────────────────────

const updateShiftSchema = shiftPropertiesSchema.extend({
  shiftId: z.string().min(1),
  isActive: z.boolean(),
});

export const updateShift = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const parsed = updateShiftSchema.parse(input);
    const tenantId = ctx.tenantId!;

    const conflict = await db.shift.findFirst({
      where: { tenantId, name: parsed.name, NOT: { id: parsed.shiftId } },
    });
    if (conflict) throw new Error(`Another shift named "${parsed.name}" already exists.`);

    const { startTime, endTime } = parsed.daySchedule
      ? deriveShiftTimes(parsed.daySchedule)
      : { startTime: "08:00", endTime: "17:00" };

    const workDays = parsed.daySchedule
      ? parsed.daySchedule.filter((d) => d.isWorkday).map((d) => d.day)
      : parsed.workDays;

    await db.shift.update({
      where: { id: parsed.shiftId },
      data: {
        name: parsed.name,
        number: parsed.number ?? null,
        startTime,
        endTime,
        workDays,
        mealBreakStart: parsed.mealBreakStart,
        mealBreakEnd: parsed.mealBreakEnd,
        isActive: parsed.isActive,
        excludeFromSetup: parsed.excludeFromSetup,
        shiftCycle: parsed.shiftCycle,
        cycleDays: parsed.cycleDays,
        cycleReferenceDate: parsed.cycleReferenceDate ?? null,
        shiftType: parsed.shiftType,
        useScheduleGroupQualifiers: parsed.useScheduleGroupQualifiers,
        averageHours: parsed.averageHours ?? null,
        daySchedule: parsed.daySchedule ?? undefined,
        mealConfig: parsed.mealConfig ?? undefined,
        breakConfig: parsed.breakConfig ?? undefined,
        differentialConfig: parsed.differentialConfig ?? undefined,
      },
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
