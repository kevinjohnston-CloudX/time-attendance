"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";
import type { HolidayRule } from "@prisma/client";

// ─── List ────────────────────────────────────────────────────────────────────

export const getHolidayRules = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [] as HolidayRule[];
    return db.holidayRule.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      include: {
        assignedHolidays: {
          include: { holiday: true },
          orderBy: { holiday: { date: "asc" } },
        },
      },
    });
  }
);

// ─── Shared schema helpers ────────────────────────────────────────────────────

const boolField = z.preprocess(
  (v) => (typeof v === "boolean" ? v : v === "true"),
  z.boolean()
);

const ruleSchema = z.object({
  number:                   z.coerce.number().int().min(1).max(99999).optional().nullable(),
  name:                     z.string().min(1).max(100),
  creditMethod:             z.enum(["FIXED_HOURS", "ACTUAL_WORKED", "SCHEDULED_HOURS"]).default("FIXED_HOURS"),
  creditHours:              z.coerce.number().min(0).max(24).default(8),
  maxCreditHours:           z.coerce.number().min(0).max(24).default(0),
  payBucket:                z.enum(["REG", "OT", "DT", "HOLIDAY"]).default("HOLIDAY"),
  payCodeId:                z.string().optional().nullable(),
  workingPremium:           z.coerce.number().min(1).max(5).default(2.0),
  includeOnProbation:       boolField.default(false),
  tenureRequiredEnabled:    boolField.default(false),
  tenureRequiredDays:       z.coerce.number().int().min(0).default(90),
  tenureRequiredBasis:      z.enum(["HIRE_DATE", "ADJUSTED_HIRE_DATE"]).default("HIRE_DATE"),
  tenureRequiredUnit:       z.enum(["DAYS", "MONTHS"]).default("DAYS"),
  dailyWeeklyAveragingOnly:       boolField.default(false),
  requireDayBefore:               boolField.default(false),
  requireDayAfter:                boolField.default(false),
  requireDayBeforeOrAfter:        boolField.default(false),
  minPeriodHours:                 z.coerce.number().min(0).default(0),
  requireDaysWorkedEnabled:       boolField.default(false),
  requireDaysWorkedCount:         z.coerce.number().int().min(0).default(0),
  requireDaysWorkedPeriod:        z.coerce.number().int().min(0).default(0),
  requireDaysWorkedPeriodUnit:    z.enum(["DAY", "WEEK"]).default("DAY"),
  requireDaysWorkedMinDailyHours: z.coerce.number().min(0).default(0),
  requireScheduledHoursPct:       boolField.default(false),
  requireScheduledHoursPctValue:  z.coerce.number().int().min(0).max(100).default(50),
  mustNotWorkOnHoliday:           boolField.default(false),
  useDynamicSchedules:            boolField.default(false),
  excludedWeekDays:               z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v.map(Number);
      if (typeof v === "string") return v ? v.split(",").map(Number) : [];
      return [];
    },
    z.array(z.number().int().min(0).max(6))
  ).default([]),
  bypassAfterEligibility:         boolField.default(false),
  payNonWorkingHolidayOnly:       boolField.default(false),
  postWorkingHoursToAccrual:      boolField.default(false),
  postWorkingHoursMax:            z.coerce.number().min(0).default(0),
  postWorkingHoursExcessEnabled:  boolField.default(false),
  postWorkingHoursExcessMin:      z.coerce.number().min(0).default(0),
  accrualCode:                    z.string().optional().nullable(),
  includeNonCalcAttendance:       boolField.default(true),
  countTowardOt:                  boolField.default(true),
  prorateEnabled:                 boolField.default(false),
  prorateLookbackDays:            z.coerce.number().int().min(1).default(28),
  prorateIncludeCurrentWeek:      boolField.default(true),
  prorateUseCustomRange:          boolField.default(false),
  prorateAppliedRule:             z.enum(["THRESHOLD", "AVERAGE_DAILY"]).default("AVERAGE_DAILY"),
  prorateThresholdHours:          z.coerce.number().min(0).default(0),
  prorateMultiplier:              z.coerce.number().min(0).default(0),
  prorateAverageDailyMaxHours:    z.coerce.number().min(0).default(8),
  prorateExcludeOt:               boolField.default(false),
  birthdayIsHoliday:              boolField.default(false),
  holidayOverridesEnabled:        boolField.default(false),
  holidayOverrides:               z.any().optional().nullable(),
});

function toDbFields(d: z.infer<typeof ruleSchema>) {
  return {
    number:                   d.number ?? null,
    creditMethod:             d.creditMethod,
    creditMinutes:            Math.round(d.creditHours * 60),
    maxCreditMinutes:         Math.round(d.maxCreditHours * 60),
    payBucket:                d.payBucket,
    payCodeId:                d.payCodeId ?? null,
    workingPremium:           Math.round(d.workingPremium * 100),
    includeOnProbation:       d.includeOnProbation,
    tenureRequiredEnabled:    d.tenureRequiredEnabled,
    tenureRequiredDays:       d.tenureRequiredDays,
    tenureRequiredBasis:      d.tenureRequiredBasis,
    tenureRequiredUnit:       d.tenureRequiredUnit,
    dailyWeeklyAveragingOnly: d.dailyWeeklyAveragingOnly,
    requireDayBefore:               d.requireDayBefore,
    requireDayAfter:                d.requireDayAfter,
    requireDayBeforeOrAfter:        d.requireDayBeforeOrAfter,
    minPeriodMinutes:               Math.round(d.minPeriodHours * 60),
    requireDaysWorkedEnabled:       d.requireDaysWorkedEnabled,
    requireDaysWorkedCount:         d.requireDaysWorkedCount,
    requireDaysWorkedPeriod:        d.requireDaysWorkedPeriod,
    requireDaysWorkedPeriodUnit:    d.requireDaysWorkedPeriodUnit,
    requireDaysWorkedMinDailyHours: d.requireDaysWorkedMinDailyHours,
    requireScheduledHoursPct:       d.requireScheduledHoursPct,
    requireScheduledHoursPctValue:  d.requireScheduledHoursPctValue,
    mustNotWorkOnHoliday:           d.mustNotWorkOnHoliday,
    useDynamicSchedules:            d.useDynamicSchedules,
    excludedWeekDays:               d.excludedWeekDays,
    bypassAfterEligibility:         d.bypassAfterEligibility,
    payNonWorkingHolidayOnly:       d.payNonWorkingHolidayOnly,
    postWorkingHoursToAccrual:      d.postWorkingHoursToAccrual,
    postWorkingHoursMax:            d.postWorkingHoursMax,
    postWorkingHoursExcessEnabled:  d.postWorkingHoursExcessEnabled,
    postWorkingHoursExcessMin:      d.postWorkingHoursExcessMin,
    accrualCode:                    d.accrualCode ?? null,
    includeNonCalcAttendance:       d.includeNonCalcAttendance,
    countTowardOt:                  d.countTowardOt,
    prorateEnabled:                 d.prorateEnabled,
    prorateLookbackDays:            d.prorateLookbackDays,
    prorateIncludeCurrentWeek:      d.prorateIncludeCurrentWeek,
    prorateUseCustomRange:          d.prorateUseCustomRange,
    prorateAppliedRule:             d.prorateAppliedRule,
    prorateThresholdHours:          d.prorateThresholdHours,
    prorateMultiplier:              d.prorateMultiplier,
    prorateAverageDailyMaxHours:    d.prorateAverageDailyMaxHours,
    prorateExcludeOt:               d.prorateExcludeOt,
    birthdayIsHoliday:              d.birthdayIsHoliday,
    holidayOverridesEnabled:        d.holidayOverridesEnabled,
    holidayOverrides:               d.holidayOverrides ?? null,
  };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export const createHolidayRule = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const data = ruleSchema.parse(input);
    const tenantId = ctx.tenantId!;
    const existing = await db.holidayRule.findUnique({
      where: { tenantId_name: { tenantId, name: data.name } },
    });
    if (existing) throw new Error(`A holiday rule named "${data.name}" already exists.`);
    await db.holidayRule.create({
      data: { tenantId, name: data.name, ...toDbFields(data) },
    });
    return { success: true };
  }
);

// ─── Update ──────────────────────────────────────────────────────────────────

const updateSchema = ruleSchema.extend({
  ruleId:   z.string().min(1),
  isActive: boolField.default(true),
});

export const updateHolidayRule = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { ruleId, isActive, ...data } = updateSchema.parse(input);
    const tenantId = ctx.tenantId!;
    const conflict = await db.holidayRule.findFirst({
      where: { tenantId, name: data.name, NOT: { id: ruleId } },
    });
    if (conflict) throw new Error(`Another holiday rule named "${data.name}" already exists.`);
    await db.holidayRule.update({
      where: { id: ruleId },
      data: { name: data.name, isActive, ...toDbFields(data) },
    });
    return { success: true };
  }
);

// ─── Delete ──────────────────────────────────────────────────────────────────

export const deleteHolidayRule = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { ruleId } = z.object({ ruleId: z.string().min(1) }).parse(input);
    const tenantId = ctx.tenantId!;
    await db.holidayRule.deleteMany({ where: { id: ruleId, tenantId } });
    return { success: true };
  }
);
