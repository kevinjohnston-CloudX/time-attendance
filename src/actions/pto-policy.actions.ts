"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import {
  createPtoPolicySchema,
  updatePtoPolicySchema,
  assignSitePtoPolicySchema,
  assignEmployeePtoPolicyOverrideSchema,
} from "@/lib/validators/pto-policy.schema";

// ─── Get all PTO policies for the tenant ─────────────────────────────────────

export const getPtoPolicies = withRBAC(
  "RULES_MANAGE",
  async ({ tenantId }, _input: void) => {
    return db.ptoPolicy.findMany({
      where: { tenantId: tenantId! },
      orderBy: { name: "asc" },
      include: {
        bands: {
          orderBy: [{ leaveTypeId: "asc" }, { minTenureMonths: "asc" }],
          include: { leaveType: { select: { id: true, name: true, category: true } } },
        },
        _count: { select: { siteLinks: true, empOverrides: true } },
      },
    });
  }
);

// ─── Create PTO policy ────────────────────────────────────────────────────────

export const createPtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { name, description, isDefault, bands } = createPtoPolicySchema.parse(input);

    const policy = await db.$transaction(async (tx) => {
      if (isDefault) {
        // Clear any existing default for this tenant
        await tx.ptoPolicy.updateMany({
          where: { tenantId: tenantId!, isDefault: true },
          data: { isDefault: false },
        });
      }

      const p = await tx.ptoPolicy.create({
        data: {
          tenantId: tenantId!,
          name,
          description,
          isDefault,
          bands: {
            create: bands.map((b) => ({
              leaveTypeId: b.leaveTypeId,
              minTenureMonths: b.minTenureMonths,
              maxTenureMonths: b.maxTenureMonths ?? null,
              annualDays: b.annualDays,
            })),
          },
        },
      });

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "PTO_POLICY_CREATED",
        entityType: "PTO_POLICY",
        entityId: p.id,
        changes: { after: { name, isDefault, bands } },
      });

      return p;
    });

    revalidatePath("/admin/pto-policies");
    return policy;
  }
);

// ─── Update PTO policy ────────────────────────────────────────────────────────

export const updatePtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { ptoPolicyId, bands, ...fields } = updatePtoPolicySchema.parse(input);

    await db.$transaction(async (tx) => {
      if (fields.isDefault) {
        await tx.ptoPolicy.updateMany({
          where: { tenantId: tenantId!, isDefault: true, id: { not: ptoPolicyId } },
          data: { isDefault: false },
        });
      }

      await tx.ptoPolicy.update({
        where: { id: ptoPolicyId },
        data: fields,
      });

      if (bands !== undefined) {
        await tx.ptoPolicyBand.deleteMany({ where: { ptoPolicyId } });
        if (bands.length > 0) {
          await tx.ptoPolicyBand.createMany({
            data: bands.map((b) => ({
              ptoPolicyId,
              leaveTypeId: b.leaveTypeId,
              minTenureMonths: b.minTenureMonths,
              maxTenureMonths: b.maxTenureMonths ?? null,
              annualDays: b.annualDays,
            })),
          });
        }
      }

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "PTO_POLICY_UPDATED",
        entityType: "PTO_POLICY",
        entityId: ptoPolicyId,
        changes: { after: { ...fields, bands } },
      });
    });

    revalidatePath("/admin/pto-policies");
  }
);

// ─── Delete PTO policy ────────────────────────────────────────────────────────

export const deletePtoPolicy = withRBAC(
  "RULES_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { ptoPolicyId } = input as { ptoPolicyId: string };

    const policy = await db.ptoPolicy.findUniqueOrThrow({
      where: { id: ptoPolicyId },
      include: { _count: { select: { siteLinks: true, empOverrides: true } } },
    });

    if (policy._count.siteLinks + policy._count.empOverrides > 0) {
      return { success: false as const, error: "This policy is still assigned to sites or employees. Remove those assignments first." };
    }

    await db.$transaction(async (tx) => {
      await tx.ptoPolicy.delete({ where: { id: ptoPolicyId } });

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: "PTO_POLICY_DELETED",
        entityType: "PTO_POLICY",
        entityId: ptoPolicyId,
        changes: { before: { name: policy.name } },
      });
    });

    revalidatePath("/admin/pto-policies");
    return { success: true as const };
  }
);

// ─── Get site PTO policies ────────────────────────────────────────────────────

export const getSitePtoPolicies = withRBAC(
  "SITE_MANAGE",
  async (_ctx, input: { siteId: string }) => {
    const { siteId } = input;

    return db.sitePtoPolicy.findMany({
      where: { siteId },
      include: {
        leaveType: { select: { id: true, name: true, category: true } },
        ptoPolicy: { select: { id: true, name: true } },
      },
    });
  }
);

// ─── Assign (or clear) a site PTO policy ─────────────────────────────────────

export const assignSitePtoPolicy = withRBAC(
  "SITE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { siteId, leaveTypeId, ptoPolicyId } = assignSitePtoPolicySchema.parse(input);

    await db.$transaction(async (tx) => {
      if (ptoPolicyId) {
        await tx.sitePtoPolicy.upsert({
          where: { siteId_leaveTypeId: { siteId, leaveTypeId } },
          create: { siteId, leaveTypeId, ptoPolicyId },
          update: { ptoPolicyId },
        });
      } else {
        await tx.sitePtoPolicy.deleteMany({ where: { siteId, leaveTypeId } });
      }

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: ptoPolicyId ? "SITE_PTO_POLICY_ASSIGNED" : "SITE_PTO_POLICY_CLEARED",
        entityType: "PTO_POLICY",
        entityId: siteId,
        changes: { after: { siteId, leaveTypeId, ptoPolicyId } },
      });
    });

    revalidatePath("/admin/sites");
  }
);

// ─── Get employee PTO policy overrides ───────────────────────────────────────

export const getEmployeePtoPolicyOverrides = withRBAC(
  "EMPLOYEE_MANAGE",
  async (_ctx, input: { employeeId: string }) => {
    const { employeeId } = input;

    return db.employeePtoPolicyOverride.findMany({
      where: { employeeId },
      include: {
        leaveType: { select: { id: true, name: true, category: true } },
        ptoPolicy: { select: { id: true, name: true } },
      },
    });
  }
);

// ─── Assign (or clear) an employee PTO policy override ───────────────────────

export const assignEmployeePtoPolicyOverride = withRBAC(
  "EMPLOYEE_MANAGE",
  async ({ employeeId: actorId, tenantId }, input: unknown) => {
    const { employeeId, leaveTypeId, ptoPolicyId } =
      assignEmployeePtoPolicyOverrideSchema.parse(input);

    await db.$transaction(async (tx) => {
      if (ptoPolicyId) {
        await tx.employeePtoPolicyOverride.upsert({
          where: { employeeId_leaveTypeId: { employeeId, leaveTypeId } },
          create: { employeeId, leaveTypeId, ptoPolicyId },
          update: { ptoPolicyId },
        });
      } else {
        await tx.employeePtoPolicyOverride.deleteMany({ where: { employeeId, leaveTypeId } });
      }

      await writeAuditLog({
        tenantId: tenantId!,
        actorId,
        action: ptoPolicyId ? "EMPLOYEE_PTO_OVERRIDE_ASSIGNED" : "EMPLOYEE_PTO_OVERRIDE_CLEARED",
        entityType: "PTO_POLICY",
        entityId: employeeId,
        changes: { after: { employeeId, leaveTypeId, ptoPolicyId } },
      });
    });

    revalidatePath(`/admin/employees/${employeeId}`);
  }
);
