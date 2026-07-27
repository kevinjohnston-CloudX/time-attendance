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
    });
  }
);

// ─── Shared schema helpers ────────────────────────────────────────────────────

const boolField = z.preprocess(
  (v) => (typeof v === "boolean" ? v : v === "true"),
  z.boolean()
);

const ruleSchema = z.object({
  number:            z.coerce.number().int().min(1).max(99999).optional().nullable(),
  name:              z.string().min(1).max(100),
  creditMethod:      z.enum(["FIXED_HOURS", "ACTUAL_WORKED", "SCHEDULED_HOURS"]).default("FIXED_HOURS"),
  creditHours:       z.coerce.number().min(0).max(24).default(8),
  maxCreditHours:    z.coerce.number().min(0).max(24).default(0),
  payBucket:         z.enum(["REG", "OT", "DT", "HOLIDAY"]).default("HOLIDAY"),
  workingPremium:    z.coerce.number().min(1).max(5).default(2.0),
  requireDayBefore:  boolField.default(false),
  requireDayAfter:   boolField.default(false),
  minPeriodHours:    z.coerce.number().min(0).default(0),
  countTowardOt:     boolField.default(true),
});

function toDbFields(d: z.infer<typeof ruleSchema>) {
  return {
    number:           d.number ?? null,
    creditMethod:     d.creditMethod,
    creditMinutes:    Math.round(d.creditHours * 60),
    maxCreditMinutes: Math.round(d.maxCreditHours * 60),
    payBucket:        d.payBucket,
    workingPremium:   Math.round(d.workingPremium * 100),
    requireDayBefore: d.requireDayBefore,
    requireDayAfter:  d.requireDayAfter,
    minPeriodMinutes: Math.round(d.minPeriodHours * 60),
    countTowardOt:    d.countTowardOt,
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
