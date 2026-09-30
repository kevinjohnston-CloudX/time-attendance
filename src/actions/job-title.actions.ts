"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export const getJobTitles = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];
    return db.jobTitle.findMany({
      where: { tenantId },
      // How many people have it, so the list can say so and a delete can be refused.
      include: { _count: { select: { employees: true } } },
      orderBy: { name: "asc" },
    });
  }
);

const jobTitleSchema = z.object({
  name:       z.string().min(1).max(255),
  externalId: z.string().max(100).optional(),
});

export const createJobTitle = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = jobTitleSchema.parse(input);
    try {
      const jobTitle = await db.jobTitle.create({
        data: {
          tenantId,
          name:       data.name,
          externalId: data.externalId ?? null,
        },
      });
      revalidatePath("/admin/site-settings");
      return { success: true as const, data: jobTitle };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error(`A job title with that name already exists.`);
      }
      throw err;
    }
  }
);

export const updateJobTitle = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = z.object({
      id:         z.string(),
      name:       z.string().min(1).max(255),
      externalId: z.string().max(100).optional(),
      isActive:   z.boolean().optional(),
    }).parse(input);
    try {
      await db.jobTitle.update({
        where: { id: data.id, tenantId },
        data: {
          name:       data.name,
          externalId: data.externalId ?? null,
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });
      revalidatePath("/admin/site-settings");
      return { success: true as const };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error(`A job title with that name already exists.`);
      }
      throw err;
    }
  }
);

export const deleteJobTitle = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const { id } = z.object({ id: z.string() }).parse(input);
    // Deleting a job title clears it from every employee who has it (ON
    // DELETE SET NULL), so it is refused while anyone does.
    const inUse = await db.employee.count({ where: { tenantId, jobTitleId: id } });
    if (inUse > 0) {
      throw new Error(
        `${inUse.toLocaleString()} ${inUse === 1 ? "employee has" : "employees have"} this job title. Move them to another one first, or set it to inactive.`,
      );
    }
    await db.jobTitle.delete({ where: { id, tenantId } });
    revalidatePath("/admin/site-settings");
    return { success: true as const };
  }
);
