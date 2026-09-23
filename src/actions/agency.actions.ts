"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { z } from "zod";

export const getAgencies = withRBAC(
  "RULES_MANAGE",
  async (ctx, _input: void) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) return [];
    return db.agency.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
    });
  }
);

const agencySchema = z.object({
  code:         z.number().int().min(0),
  description:  z.string().min(1).max(255),
  laborRate:    z.number().min(0).default(0),
  chargeRate:   z.number().min(0).default(0),
  inactiveOn:   z.string().nullable().optional(),
  maxWorkHours: z.number().min(0).default(0),
});

export const createAgency = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = agencySchema.parse(input);
    const agency = await db.agency.create({
      data: {
        tenantId,
        code:         data.code,
        description:  data.description,
        laborRate:    data.laborRate,
        chargeRate:   data.chargeRate,
        inactiveOn:   data.inactiveOn ? new Date(data.inactiveOn) : null,
        maxWorkHours: data.maxWorkHours,
      },
    });
    revalidatePath("/admin/site-settings");
    return { success: true as const, data: agency };
  }
);

export const updateAgency = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const data = z.object({ id: z.string() }).merge(agencySchema).parse(input);
    await db.agency.update({
      where: { id: data.id, tenantId },
      data: {
        code:         data.code,
        description:  data.description,
        laborRate:    data.laborRate,
        chargeRate:   data.chargeRate,
        inactiveOn:   data.inactiveOn ? new Date(data.inactiveOn) : null,
        maxWorkHours: data.maxWorkHours,
      },
    });
    revalidatePath("/admin/site-settings");
    return { success: true as const };
  }
);

export const deleteAgency = withRBAC(
  "RULES_MANAGE",
  async (ctx, input: unknown) => {
    const tenantId = ctx.tenantId;
    if (!tenantId) throw new Error("No tenant");
    const { id } = z.object({ id: z.string() }).parse(input);
    await db.agency.delete({ where: { id, tenantId } });
    revalidatePath("/admin/site-settings");
    return { success: true as const };
  }
);
