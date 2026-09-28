import { db } from "@/lib/db";

/**
 * Slows down password guessing, on the web and in the mobile app.
 *
 * <p>Every wrong password is written to the audit log with the address it
 * came from. After {@link PER_ACCOUNT} wrong passwords for one account in
 * {@link WINDOW_MIN} minutes, that account refuses every password, right or
 * wrong, until the window has passed; after {@link PER_ADDRESS} from one
 * address, so does every account tried from it. Kept in the database rather
 * than in memory because the site runs on many short-lived servers.
 */

export const WINDOW_MIN = 15;
const PER_ACCOUNT = 5;
const PER_ADDRESS = 30;
const FAILED = "LOGIN_FAILED";

/** The caller's address, from the proxy's header, or null when there is none. */
export function clientAddress(headers: Headers | null | undefined): string | null {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip") || null;
}

export async function isLockedOut(userId: string, address: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000);
  const [forAccount, fromAddress] = await Promise.all([
    db.auditLog.count({ where: { action: FAILED, entityType: "USER", entityId: userId, createdAt: { gte: since } } }),
    address
      ? db.auditLog.count({ where: { action: FAILED, ipAddress: address, createdAt: { gte: since } } })
      : Promise.resolve(0),
  ]);
  return forAccount >= PER_ACCOUNT || fromAddress >= PER_ADDRESS;
}

export async function recordFailedLogin(
  userId: string,
  tenantId: string | null | undefined,
  address: string | null,
  via: "web" | "mobile",
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: tenantId ?? undefined,
      action: FAILED,
      entityType: "USER",
      entityId: userId,
      ipAddress: address ?? undefined,
      changes: { via },
    },
  });
}
