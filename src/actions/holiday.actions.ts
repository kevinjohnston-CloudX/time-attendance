"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";

export const getHolidays = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];
    return db.holiday.findMany({
      where: { tenantId },
      orderBy: { date: "asc" },
      include: {
        holidayRules: {
          select: { holidayRuleId: true },
        },
      },
    });
  }
);

/** Every rule id has to be one of this company's holiday rules. */
async function assertOwnRules(tenantId: string, ruleIds: string[]) {
  const unique = [...new Set(ruleIds)];
  if (!unique.length) return;
  const found = await db.holidayRule.count({ where: { tenantId, id: { in: unique } } });
  if (found !== unique.length) throw new Error("NOT_FOUND");
}

const createHolidaySchema = z.object({
  name: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  bypassAfterEligibility: z.preprocess(
    (v) => (typeof v === "boolean" ? v : v === "true"),
    z.boolean()
  ).default(false),
  ruleIds: z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v.filter(Boolean);
      if (typeof v === "string") return v ? v.split(",").filter(Boolean) : [];
      return [];
    },
    z.array(z.string())
  ).default([]),
});

export const createHoliday = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { name, date, observedDate, bypassAfterEligibility, ruleIds } = createHolidaySchema.parse(input);
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("Tenant context required");
    await assertOwnRules(tenantId, ruleIds);

    const dateObj = new Date(date + "T00:00:00.000Z");
    const observedDateObj = observedDate ? new Date(observedDate + "T00:00:00.000Z") : null;

    const existing = await db.holiday.findUnique({
      where: { tenantId_date: { tenantId, date: dateObj } },
    });
    if (existing) throw new Error("A holiday already exists on that date.");

    const holiday = await db.holiday.create({
      data: {
        tenantId,
        name,
        date: dateObj,
        observedDate: observedDateObj,
        bypassAfterEligibility,
      },
    });

    if (ruleIds.length > 0) {
      await db.holidayRuleHoliday.createMany({
        data: ruleIds.map((holidayRuleId) => ({ holidayRuleId, holidayId: holiday.id })),
        skipDuplicates: true,
      });
    }

    return { success: true };
  }
);

const updateHolidaySchema = z.object({
  holidayId: z.string().min(1),
  name: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  isActive: z.boolean(),
  bypassAfterEligibility: z.preprocess(
    (v) => (typeof v === "boolean" ? v : v === "true"),
    z.boolean()
  ).default(false),
  ruleIds: z.preprocess(
    (v) => {
      if (Array.isArray(v)) return v.filter(Boolean);
      if (typeof v === "string") return v ? v.split(",").filter(Boolean) : [];
      return [];
    },
    z.array(z.string())
  ).default([]),
});

export const updateHoliday = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { holidayId, name, date, observedDate, isActive, bypassAfterEligibility, ruleIds } = updateHolidaySchema.parse(input);
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("Tenant context required");
    // Found inside this company first; another company's id is "not found".
    const own = await db.holiday.findFirst({ where: { id: holidayId, tenantId }, select: { id: true } });
    if (!own) throw new Error("NOT_FOUND");
    await assertOwnRules(tenantId, ruleIds);

    const dateObj = new Date(date + "T00:00:00.000Z");
    const observedDateObj = observedDate ? new Date(observedDate + "T00:00:00.000Z") : null;

    const conflict = await db.holiday.findFirst({
      where: { tenantId, date: dateObj, NOT: { id: holidayId } },
    });
    if (conflict) throw new Error("Another holiday already exists on that date.");

    // One transaction, so a failure part way never leaves the holiday with
    // its old rules removed and the new ones not yet added.
    await db.$transaction(async (tx) => {
      await tx.holiday.update({
        where: { id: own.id },
        data: { name, date: dateObj, observedDate: observedDateObj, isActive, bypassAfterEligibility },
      });
      await tx.holidayRuleHoliday.deleteMany({ where: { holidayId: own.id } });
      if (ruleIds.length > 0) {
        await tx.holidayRuleHoliday.createMany({
          data: ruleIds.map((holidayRuleId) => ({ holidayRuleId, holidayId: own.id })),
          skipDuplicates: true,
        });
      }
    });

    return { success: true };
  }
);

export const deleteHoliday = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { holidayId } = z.object({ holidayId: z.string().min(1) }).parse(input);
    if (!ctx.tenantId) throw new Error("Tenant context required");
    const { count } = await db.holiday.deleteMany({ where: { id: holidayId, tenantId: ctx.tenantId } });
    if (count === 0) throw new Error("NOT_FOUND");
    return { success: true };
  }
);
