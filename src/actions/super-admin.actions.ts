"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createTenantSchema, type CreateTenantInput } from "@/lib/validators/super-admin.schema";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return session;
}

export async function getTenants(): Promise<
  ActionResult<
    Array<{
      id: string;
      name: string;
      slug: string;
      isActive: boolean;
      createdAt: Date;
      _count: { employees: number; sites: number };
    }>
  >
> {
  try {
    await requireSuperAdmin();
    const tenants = await db.tenant.findMany({
      include: {
        _count: { select: { employees: true, sites: true } },
      },
      orderBy: { name: "asc" },
    });
    return { success: true, data: tenants };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "INTERNAL_ERROR" };
  }
}

export async function getTenantBySlug(
  slug: string
): Promise<ActionResult<{
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  sites: Array<{ id: string; name: string; timezone: string; isActive: boolean }>;
  _count: { employees: number };
  employees: Array<{
    id: string;
    employeeCode: string;
    role: string;
    isActive: boolean;
    user: { name: string | null; username: string };
  }>;
}>> {
  try {
    await requireSuperAdmin();
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { slug },
      include: {
        sites: { orderBy: { name: "asc" } },
        employees: {
          include: { user: { select: { name: true, username: true } } },
          orderBy: { user: { name: "asc" } },
          take: 20,
        },
        _count: { select: { employees: true } },
      },
    });
    return { success: true, data: tenant };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "INTERNAL_ERROR" };
  }
}

export async function createTenant(
  input: CreateTenantInput
): Promise<ActionResult<{ id: string; name: string; slug: string }>> {
  try {
    await requireSuperAdmin();
    const parsed = createTenantSchema.parse(input);

    const tenant = await db.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: parsed.name, slug: parsed.slug },
      });

      const site = await tx.site.create({
        data: { name: parsed.siteName, timezone: parsed.siteTimezone, tenantId: t.id },
      });

      const dept = await tx.department.create({
        data: { name: "General", siteId: site.id, tenantId: t.id },
      });

      const ruleSet = await tx.ruleSet.create({
        data: { name: "Default", tenantId: t.id, isDefault: true },
      });

      const passwordHash = await bcrypt.hash(parsed.adminPassword, 12);
      const user = await tx.user.create({
        data: { name: parsed.adminName, username: parsed.adminUsername.toLowerCase(), passwordHash },
      });

      await tx.employee.create({
        data: {
          userId: user.id,
          tenantId: t.id,
          employeeCode: parsed.adminEmployeeCode,
          role: "SYSTEM_ADMIN",
          siteId: site.id,
          departmentId: dept.id,
          ruleSetId: ruleSet.id,
          hireDate: new Date(),
        },
      });

      return t;
    });

    revalidatePath("/super-admin/tenants");
    return { success: true, data: { id: tenant.id, name: tenant.name, slug: tenant.slug } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "INTERNAL_ERROR" };
  }
}

export async function enterTenant(tenantId: string): Promise<never> {
  await requireSuperAdmin();
  const cookieStore = await cookies();
  cookieStore.set(SUPER_ADMIN_TENANT_COOKIE, tenantId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  redirect("/dashboard");
}

export async function exitTenant(): Promise<never> {
  await requireSuperAdmin();
  const cookieStore = await cookies();
  cookieStore.delete(SUPER_ADMIN_TENANT_COOKIE);
  redirect("/super-admin/tenants");
}

export async function toggleTenantActive(
  tenantId: string
): Promise<ActionResult<{ isActive: boolean }>> {
  try {
    await requireSuperAdmin();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const updated = await db.tenant.update({
      where: { id: tenantId },
      data: { isActive: !tenant.isActive },
    });
    revalidatePath("/super-admin/tenants");
    return { success: true, data: { isActive: updated.isActive } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "INTERNAL_ERROR" };
  }
}
