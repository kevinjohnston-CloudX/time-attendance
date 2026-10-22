import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SUPER_ADMIN_TENANT_COOKIE } from "@/lib/constants";
import { writeAuditLog } from "@/lib/audit/logger";

/**
 * A super admin opens a company: the company cookie for this browser, a line
 * on that company's record (a super admin working inside it is on its record),
 * and the company saved as their last one, so their next sign in goes straight
 * back into it. Only from a server action or a route handler, which may set
 * cookies. The caller has already checked they are a super admin.
 *
 * <p>Returns false when the company does not exist (removed since).
 */
export async function enterCompany(userId: string, tenantId: string): Promise<boolean> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return false;
  await writeAuditLog({
    tenantId,
    action: "SUPER_ADMIN_ENTERED",
    entityType: "USER",
    entityId: userId,
  });
  // Remembering is a convenience: a failed save never stops them going in.
  await db.user.update({ where: { id: userId }, data: { lastTenantId: tenantId } }).catch(() => {});
  const cookieStore = await cookies();
  cookieStore.set(SUPER_ADMIN_TENANT_COOKIE, tenantId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return true;
}

/** The company a super admin last opened, when it still exists; else null. */
export async function lastCompany(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { lastTenantId: true } });
  if (!user?.lastTenantId) return null;
  const tenant = await db.tenant.findUnique({ where: { id: user.lastTenantId }, select: { id: true } });
  return tenant?.id ?? null;
}
