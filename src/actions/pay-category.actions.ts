"use server";

import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";
import type { PayCategory } from "@prisma/client";

export const getPayCategories = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [] as PayCategory[];
    return db.payCategory.findMany({
      where: { tenantId },
      orderBy: { number: "asc" },
    });
  }
);

const categorySchema = z.object({
  number:      z.coerce.number().int().min(1).max(9999),
  description: z.string().max(255).optional(),
});

export const createPayCategory = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = categorySchema.parse(input);
    return db.payCategory.create({
      data: { tenantId, number: data.number, description: data.description ?? null },
    });
  }
);

export const updatePayCategory = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = z.object({
      id:          z.string(),
      number:      z.coerce.number().int().min(1).max(9999),
      description: z.string().max(255).optional(),
      isActive:    z.boolean().optional(),
    }).parse(input);
    return db.payCategory.update({
      where: { id: data.id, tenantId },
      data: {
        number:      data.number,
        description: data.description ?? null,
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }
);

export const deletePayCategory = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const { id } = z.object({ id: z.string() }).parse(input);
    await db.payCategory.delete({ where: { id, tenantId } });
    return { deleted: true };
  }
);
