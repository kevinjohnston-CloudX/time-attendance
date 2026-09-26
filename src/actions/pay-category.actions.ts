"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const getPayCategories = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];
    return db.payCategory.findMany({
      where: { tenantId },
      orderBy: { number: "asc" },
      include: {
        ptoPolicies: {
          include: {
            ptoPolicy: {
              select: {
                id: true,
                name: true,
                rules: {
                  select: {
                    leaveTypeId: true,
                    leaveType: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
        availableLeaveTypes: {
          select: { leaveTypeId: true },
        },
        _count: { select: { employees: true } },
      },
    });
  }
);

const categorySchema = z.object({
  number:                  z.coerce.number().int().min(1).max(9999),
  description:             z.string().max(255).optional(),
  ptoPolicyIds:            z.array(z.string()).optional(),
  limitLeaveTypes:         z.boolean().optional(),
  availableLeaveTypeIds:   z.array(z.string()).optional(),
});

/** Every policy and leave type id has to be this company's. */
async function assertOwn(tenantId: string, ptoPolicyIds: string[] = [], leaveTypeIds: string[] = []) {
  const policies = [...new Set(ptoPolicyIds)];
  const types = [...new Set(leaveTypeIds)];
  const [p, t] = await Promise.all([
    policies.length ? db.ptoPolicy.count({ where: { tenantId, id: { in: policies } } }) : 0,
    types.length ? db.leaveType.count({ where: { tenantId, id: { in: types } } }) : 0,
  ]);
  if (p !== policies.length || t !== types.length) throw new Error("NOT_FOUND");
}

async function checkOverlap(tenantId: string, ptoPolicyIds: string[]): Promise<string | null> {
  if (ptoPolicyIds.length < 2) return null;
  const policies = await db.ptoPolicy.findMany({
    where: { tenantId, id: { in: ptoPolicyIds } },
    select: {
      id: true, name: true,
      rules: { select: { leaveTypeId: true, leaveType: { select: { name: true } } } },
    },
  });
  const seen = new Map<string, string>(); // leaveTypeId → policy name (across policies)
  for (const p of policies) {
    // Deduplicate leave types within this policy (multiple tiers share the same leaveTypeId)
    const thisPolicy = new Map<string, string>(); // leaveTypeId → leaveType name
    for (const r of p.rules) {
      thisPolicy.set(r.leaveTypeId, r.leaveType.name);
    }
    // Check for conflicts with other policies already processed
    for (const [ltId, ltName] of thisPolicy) {
      if (seen.has(ltId)) {
        return `${ltName} is covered by both ${seen.get(ltId)} and ${p.name}. Keep only one of them.`;
      }
    }
    for (const [ltId] of thisPolicy) {
      seen.set(ltId, p.name);
    }
  }
  return null;
}

export const createPayCategory = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = categorySchema.parse(input);
    await assertOwn(tenantId, data.ptoPolicyIds, data.availableLeaveTypeIds);

    const overlapErr = await checkOverlap(tenantId, data.ptoPolicyIds ?? []);
    if (overlapErr) throw new Error(overlapErr);

    try {
      const category = await db.$transaction(async (tx) => {
        const cat = await tx.payCategory.create({
          data: { tenantId, number: data.number, description: data.description ?? null, limitLeaveTypes: data.limitLeaveTypes ?? false },
        });
        if (data.ptoPolicyIds?.length) {
          await tx.payCategoryPtoPolicy.createMany({
            data: data.ptoPolicyIds.map((ptoPolicyId) => ({ payCategoryId: cat.id, ptoPolicyId })),
          });
        }
        if (data.limitLeaveTypes && data.availableLeaveTypeIds?.length) {
          await tx.payCategoryLeaveType.createMany({
            data: data.availableLeaveTypeIds.map((leaveTypeId) => ({ payCategoryId: cat.id, leaveTypeId })),
          });
        }
        return cat;
      });
      revalidatePath("/admin/site-settings");
      return { success: true as const, data: category };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error(`Category number ${data.number} already exists.`);
      }
      throw err;
    }
  }
);

export const updatePayCategory = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = z.object({
      id:                    z.string(),
      number:                z.coerce.number().int().min(1).max(9999),
      description:           z.string().max(255).optional(),
      isActive:              z.boolean().optional(),
      ptoPolicyIds:          z.array(z.string()).optional(),
      limitLeaveTypes:       z.boolean().optional(),
      availableLeaveTypeIds: z.array(z.string()).optional(),
    }).parse(input);
    await assertOwn(tenantId, data.ptoPolicyIds, data.availableLeaveTypeIds);

    const overlapErr = await checkOverlap(tenantId, data.ptoPolicyIds ?? []);
    if (overlapErr) throw new Error(overlapErr);

    try {
      await db.$transaction(async (tx) => {
        await tx.payCategory.update({
          where: { id: data.id, tenantId },
          data: {
            number:          data.number,
            description:     data.description ?? null,
            ...(data.isActive       !== undefined && { isActive: data.isActive }),
            ...(data.limitLeaveTypes !== undefined && { limitLeaveTypes: data.limitLeaveTypes }),
          },
        });
        if (data.ptoPolicyIds !== undefined) {
          await tx.payCategoryPtoPolicy.deleteMany({ where: { payCategoryId: data.id } });
          if (data.ptoPolicyIds.length) {
            await tx.payCategoryPtoPolicy.createMany({
              data: data.ptoPolicyIds.map((ptoPolicyId) => ({ payCategoryId: data.id, ptoPolicyId })),
            });
          }
        }
        // Always reconcile junction rows when limitLeaveTypes is part of the update
        if (data.limitLeaveTypes !== undefined) {
          await tx.payCategoryLeaveType.deleteMany({ where: { payCategoryId: data.id } });
          if (data.limitLeaveTypes && data.availableLeaveTypeIds?.length) {
            await tx.payCategoryLeaveType.createMany({
              data: data.availableLeaveTypeIds.map((leaveTypeId) => ({ payCategoryId: data.id, leaveTypeId })),
            });
          }
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error(`Category number ${data.number} already exists.`);
      }
      throw err;
    }

    revalidatePath("/admin/site-settings");
    return { success: true as const };
  }
);

export const deletePayCategory = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const { id } = z.object({ id: z.string() }).parse(input);
    // Deleting a category in use clears it from every employee on it, with
    // nothing to say it happened, so it is refused while anyone is on it.
    const inUse = await db.employee.count({ where: { tenantId, payCategoryId: id } });
    if (inUse > 0) {
      throw new Error(
        `${inUse.toLocaleString()} ${inUse === 1 ? "employee is" : "employees are"} in this pay category. Move them to another one first, or set it to inactive.`,
      );
    }
    await db.payCategory.delete({ where: { id, tenantId } });
    revalidatePath("/admin/site-settings");
    return { success: true as const };
  }
);
