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
    });
  }
);

const createHolidaySchema = z.object({
  name: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const createHoliday = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { name, date, observedDate } = createHolidaySchema.parse(input);
    const tenantId = ctx.tenantId!;

    const dateObj = new Date(date + "T00:00:00.000Z");
    const observedDateObj = observedDate ? new Date(observedDate + "T00:00:00.000Z") : null;

    const existing = await db.holiday.findUnique({
      where: { tenantId_date: { tenantId, date: dateObj } },
    });
    if (existing) throw new Error("A holiday already exists on that date.");

    await db.holiday.create({
      data: { tenantId, name, date: dateObj, observedDate: observedDateObj },
    });

    return { success: true };
  }
);

const updateHolidaySchema = z.object({
  holidayId: z.string().min(1),
  name: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  observedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  isActive: z.boolean(),
});

export const updateHoliday = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const { holidayId, name, date, observedDate, isActive } = updateHolidaySchema.parse(input);
    const tenantId = ctx.tenantId!;

    const dateObj = new Date(date + "T00:00:00.000Z");
    const observedDateObj = observedDate ? new Date(observedDate + "T00:00:00.000Z") : null;

    const conflict = await db.holiday.findFirst({
      where: { tenantId, date: dateObj, NOT: { id: holidayId } },
    });
    if (conflict) throw new Error("Another holiday already exists on that date.");

    await db.holiday.update({
      where: { id: holidayId },
      data: { name, date: dateObj, observedDate: observedDateObj, isActive },
    });

    return { success: true };
  }
);

export const deleteHoliday = withRBAC(
  "RULES_MANAGE",
  async (_ctx, input: unknown) => {
    const { holidayId } = z.object({ holidayId: z.string().min(1) }).parse(input);
    await db.holiday.delete({ where: { id: holidayId } });
    return { success: true };
  }
);
