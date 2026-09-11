"use server";

import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { VIEW_AS_ROLE_COOKIE } from "@/lib/constants";

const PRIVILEGED_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

export async function setViewAsRole(targetCustomRoleId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");

  const realRole = session.user.role ?? "EMPLOYEE";
  const isPrivileged = PRIVILEGED_ROLES.includes(realRole);
  const canViewAs = session.user.canViewAs ?? false;

  if (!isPrivileged && !canViewAs) throw new Error("Not authorized");

  // Validate target role exists
  const targetRole = await db.customRole.findUnique({
    where: { id: targetCustomRoleId },
    select: { rank: true, name: true, isActive: true },
  });
  if (!targetRole?.isActive) throw new Error("Role not found");

  // Non-privileged canViewAs users can only view-as roles with a lower rank
  if (!isPrivileged) {
    const userCustomRoleId = session.user.customRoleId ?? null;
    if (!userCustomRoleId) throw new Error("No role assigned");
    const userRole = await db.customRole.findUnique({
      where: { id: userCustomRoleId },
      select: { rank: true },
    });
    if (!userRole || targetRole.rank >= userRole.rank) {
      throw new Error("Can only view-as a role with a lower rank");
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(VIEW_AS_ROLE_COOKIE, targetCustomRoleId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
}

export async function clearViewAsRole() {
  const session = await auth();
  if (!session?.user) return;
  const cookieStore = await cookies();
  cookieStore.delete(VIEW_AS_ROLE_COOKIE);
}
