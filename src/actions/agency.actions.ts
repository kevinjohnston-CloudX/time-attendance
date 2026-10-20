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
    const agencies = await db.agency.findMany({
      where: { tenantId },
      // How many people have it, so the list can say so and a delete can be refused.
      include: { _count: { select: { employees: true } } },
      orderBy: { code: "asc" },
    });
    // The default markup as a plain number: a Decimal does not cross to the browser.
    return agencies.map((a) => ({ ...a, defaultMarkupPct: a.defaultMarkupPct == null ? null : Number(a.defaultMarkupPct) }));
  }
);

const agencySchema = z.object({
  code:         z.number().int().min(0),
  description:  z.string().min(1).max(255),
  laborRate:    z.number().min(0).default(0),
  // Kept for code already deployed; the screens send the markup instead.
  chargeRate:   z.number().min(0).optional(),
  /** Percent added to a person's hourly rate for the charge rate: 32 is 32%. */
  defaultMarkupPct: z.number().min(0, "A markup can't be below 0%").max(1000).nullable().optional(),
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
        ...(data.chargeRate !== undefined && { chargeRate: data.chargeRate }),
        defaultMarkupPct: data.defaultMarkupPct ?? null,
        inactiveOn:   data.inactiveOn ? new Date(data.inactiveOn) : null,
        maxWorkHours: data.maxWorkHours,
      },
    });
    revalidatePath("/admin/site-settings");
    return { success: true as const, data: { ...agency, defaultMarkupPct: agency.defaultMarkupPct == null ? null : Number(agency.defaultMarkupPct) } };
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
        ...(data.chargeRate !== undefined && { chargeRate: data.chargeRate }),
        ...(data.defaultMarkupPct !== undefined && { defaultMarkupPct: data.defaultMarkupPct }),
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
    // Deleting an agency takes it off every employee in it (the column is
    // ON DELETE SET NULL) with nothing to say so, so it is refused while
    // anyone is in it, as pay categories and pay types are.
    const inUse = await db.employee.count({ where: { tenantId, agencyId: id } });
    if (inUse > 0) {
      throw new Error(
        `${inUse.toLocaleString()} ${inUse === 1 ? "employee is" : "employees are"} in this agency. Move them to another one first, or give it an inactive date.`,
      );
    }
    await db.agency.delete({ where: { id, tenantId } });
    revalidatePath("/admin/site-settings");
    return { success: true as const };
  }
);
