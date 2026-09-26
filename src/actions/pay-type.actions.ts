"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const getPayTypes = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];
    return db.payType.findMany({
      where: { tenantId },
      orderBy: { number: "asc" },
      include: { _count: { select: { employees: true } } },
    });
  }
);

const payTypeSchema = z.object({
  number:                 z.coerce.number().int().min(1).max(9999),
  description:            z.string().max(255).optional(),
  includeInEmployeeSetup: z.boolean().optional(),
});

export const createPayType = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = payTypeSchema.parse(input);
    try {
      const payType = await db.payType.create({
        data: {
          tenantId,
          number: data.number,
          description: data.description ?? null,
          includeInEmployeeSetup: data.includeInEmployeeSetup ?? true,
        },
      });
      revalidatePath("/admin/site-settings");
      return { success: true as const, data: payType };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error(`Pay type number ${data.number} already exists.`);
      }
      throw err;
    }
  }
);

export const updatePayType = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = z.object({
      id:                     z.string(),
      number:                 z.coerce.number().int().min(1).max(9999),
      description:            z.string().max(255).optional(),
      includeInEmployeeSetup: z.boolean().optional(),
      isActive:               z.boolean().optional(),
    }).parse(input);
    try {
      await db.payType.update({
        where: { id: data.id, tenantId },
        data: {
          number:      data.number,
          description: data.description ?? null,
          ...(data.includeInEmployeeSetup !== undefined && { includeInEmployeeSetup: data.includeInEmployeeSetup }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });
      revalidatePath("/admin/site-settings");
      return { success: true as const };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error(`Pay type number ${data.number} already exists.`);
      }
      throw err;
    }
  }
);

export const deletePayType = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const { id } = z.object({ id: z.string() }).parse(input);
    // Deleting a pay type in use clears it from every employee on it, so it
    // is refused while anyone has it.
    const inUse = await db.employee.count({ where: { tenantId, payTypeId: id } });
    if (inUse > 0) {
      throw new Error(
        `${inUse.toLocaleString()} ${inUse === 1 ? "employee has" : "employees have"} this pay type. Move them to another one first, or set it to inactive.`,
      );
    }
    await db.payType.delete({ where: { id, tenantId } });
    revalidatePath("/admin/site-settings");
    return { success: true as const };
  }
);
