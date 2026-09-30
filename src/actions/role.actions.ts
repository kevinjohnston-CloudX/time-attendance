"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withRBAC } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/logger";
import { invalidateRoleCache } from "@/lib/rbac/permission-resolver";
import {
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from "@/lib/validators/role.schema";

/**
 * A role limited to Live Attendance never also gets View As: previewing other
 * roles is a way out of the one page, and the limit exists to leave none.
 */
function viewAsFor(liveAttendanceOnly: boolean | undefined, canViewAs: boolean | undefined) {
  return liveAttendanceOnly ? false : canViewAs;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getRoles = withRBAC(
  "ROLE_MANAGE",
  async ({ tenantId }, _input: void) => {
    const t = tenantId ?? undefined;
    return db.customRole.findMany({
      where: { tenantId: t },
      include: {
        _count: { select: { employees: true } },
      },
      orderBy: { rank: "asc" },
    });
  }
);

export const getRoleById = withRBAC(
  "ROLE_MANAGE",
  async ({ tenantId }, input: { id: string }) => {
    const role = await db.customRole.findFirst({
      where: { id: input.id, tenantId: tenantId ?? undefined },
      include: {
        permissions: true,
        _count: { select: { employees: true } },
      },
    });
    if (!role) throw new Error("Role not found");
    return role;
  }
);

// ─── Mutations ───────────────────────────────────────────────────────────────

export const createRole = withRBAC(
  "ROLE_MANAGE",
  async ({ tenantId }, input: CreateRoleInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const data = createRoleSchema.parse(input);

    const role = await db.customRole.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description,
        rank: data.rank,
        canViewAs: viewAsFor(data.liveAttendanceOnly, data.canViewAs) ?? false,
        liveAttendanceOnly: data.liveAttendanceOnly ?? false,
        permissions: {
          create: data.permissions.map((p) => ({
            resource: p.resource,
            action: p.action,
            scope: p.scope,
          })),
        },
      },
      include: { permissions: true },
    });

    await writeAuditLog({
      tenantId,
      action: "CREATE",
      entityType: "ROLE",
      entityId: role.id,
      changes: { after: { name: role.name, permissions: data.permissions } },
    });

    revalidatePath("/admin/roles");
    return role;
  }
);

export const updateRole = withRBAC(
  "ROLE_MANAGE",
  async ({ tenantId }, input: UpdateRoleInput) => {
    if (!tenantId) throw new Error("Tenant context required");
    const data = updateRoleSchema.parse(input);

    const existing = await db.customRole.findFirst({
      where: { id: data.id, tenantId },
      include: { permissions: true },
    });
    if (!existing) throw new Error("Role not found");

    // Block rename of system roles
    if (existing.isSystem && data.name && data.name !== existing.name) {
      throw new Error("Cannot rename system roles");
    }
    // The built-in roles carry whole departments; limiting one to a single
    // page would lock out every HR admin or supervisor at once.
    if (existing.isSystem && data.liveAttendanceOnly) {
      throw new Error("A built-in role cannot be limited to Live Attendance. Create a custom role for this.");
    }
    const liveAttendanceOnly = data.liveAttendanceOnly ?? existing.liveAttendanceOnly;

    // Update role fields
    const role = await db.customRole.update({
      where: { id: data.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.rank !== undefined && { rank: data.rank }),
        ...(data.canViewAs !== undefined && { canViewAs: viewAsFor(liveAttendanceOnly, data.canViewAs) }),
        ...(data.liveAttendanceOnly !== undefined && { liveAttendanceOnly: data.liveAttendanceOnly }),
        ...(liveAttendanceOnly && { canViewAs: false }),
      },
    });

    // Replace permissions if provided
    if (data.permissions) {
      await db.rolePermission.deleteMany({ where: { customRoleId: data.id } });
      await db.rolePermission.createMany({
        data: data.permissions.map((p) => ({
          customRoleId: data.id,
          resource: p.resource,
          action: p.action,
          scope: p.scope,
        })),
      });
    }

    invalidateRoleCache(data.id);

    await writeAuditLog({
      tenantId,
      action: "UPDATE",
      entityType: "ROLE",
      entityId: role.id,
      changes: { before: { name: existing.name }, after: { name: role.name, permissions: data.permissions } },
    });

    revalidatePath("/admin/roles");
    return role;
  }
);

export const deleteRole = withRBAC(
  "ROLE_MANAGE",
  async ({ tenantId }, input: { id: string }) => {
    if (!tenantId) throw new Error("Tenant context required");

    const role = await db.customRole.findFirst({
      where: { id: input.id, tenantId },
      include: { _count: { select: { employees: true } } },
    });
    if (!role) throw new Error("Role not found");
    if (role.isSystem) throw new Error("Cannot delete system roles");
    if (role._count.employees > 0) {
      throw new Error(
        `The role "${role.name}" cannot be deleted while ${role._count.employees} ${role._count.employees === 1 ? "employee is" : "employees are"} assigned to it.`
      );
    }

    await db.customRole.delete({ where: { id: input.id } });
    invalidateRoleCache(input.id);

    await writeAuditLog({
      tenantId,
      action: "DELETE",
      entityType: "ROLE",
      entityId: input.id,
      changes: { before: { name: role.name } },
    });

    revalidatePath("/admin/roles");
    return { deleted: true };
  }
);

export const duplicateRole = withRBAC(
  "ROLE_MANAGE",
  async ({ tenantId }, input: { id: string; name: string }) => {
    if (!tenantId) throw new Error("Tenant context required");

    const source = await db.customRole.findFirst({
      where: { id: input.id, tenantId },
      include: { permissions: true },
    });
    if (!source) throw new Error("Source role not found");

    const role = await db.customRole.create({
      data: {
        tenantId,
        name: input.name,
        description: source.description,
        rank: source.rank,
        canViewAs: source.canViewAs,
        liveAttendanceOnly: source.liveAttendanceOnly,
        permissions: {
          create: source.permissions.map((p) => ({
            resource: p.resource,
            action: p.action,
            scope: p.scope,
          })),
        },
      },
      include: { permissions: true },
    });

    revalidatePath("/admin/roles");
    return role;
  }
);
