"use server";

import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { VIEW_AS_ROLE_COOKIE } from "@/lib/constants";

const ALLOWED_REAL_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN"];

export async function setViewAsRole(role: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  if (!ALLOWED_REAL_ROLES.includes(session.user.role ?? "")) throw new Error("Not authorized");
  const cookieStore = await cookies();
  cookieStore.set(VIEW_AS_ROLE_COOKIE, role, { path: "/", httpOnly: true, sameSite: "lax" });
}

export async function clearViewAsRole() {
  const session = await auth();
  if (!session?.user) return;
  const cookieStore = await cookies();
  cookieStore.delete(VIEW_AS_ROLE_COOKIE);
}
