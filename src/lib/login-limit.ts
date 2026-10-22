import { createHash } from "crypto";
import { db } from "@/lib/db";

/**
 * Slows down password guessing, on the web and in the mobile app.
 *
 * <p>Every wrong password is written to the audit log with the address it
 * came from. Within {@link WINDOW_MIN} minutes, a sign in is refused, right
 * password or wrong, after:
 * <ul>
 *   <li>{@link PER_ACCOUNT_AND_ADDRESS} wrong passwords for the account from
 *       this address. Counted per place, so somebody typing wrong passwords
 *       for a known email locks it only where they are, and the person
 *       themselves still signs in from the office or home. A lock on the
 *       account as a whole let anyone keep it locked all day.</li>
 *   <li>{@link PER_ACCOUNT} wrong passwords for the account from anywhere,
 *       for guessing spread over many machines.</li>
 *   <li>{@link PER_ADDRESS} wrong passwords from this address for any
 *       accounts, so one machine cannot work through a list.</li>
 * </ul>
 *
 * <p>An email with no password login is counted the same way, under a hash
 * of what was typed, so "too many attempts" no longer tells a real account
 * from a made-up one. Kept in the database rather than in memory because the
 * site runs on many short-lived servers.
 */

export const WINDOW_MIN = 15;
const PER_ACCOUNT_AND_ADDRESS = 5;
const PER_ACCOUNT = 20;
const PER_ADDRESS = 30;
const FAILED = "LOGIN_FAILED";

/**
 * A bcrypt hash of a random value nobody knows, at the same cost as real
 * ones. Checked when the email has no password login, so a wrong guess takes
 * as long for an unknown email as for a real one: an unknown email used to
 * fail at once, a real one after the password check, and the difference said
 * which emails had accounts.
 */
export const DUMMY_PASSWORD_HASH = "$2b$12$jRtnU4LkWTKFzbvtS4iATeE4BLThsU4tcJlGyEsHUU9okU5GspK86";

/** The caller's address, from the proxy's header, or null when there is none. */
export function clientAddress(headers: Headers | null | undefined): string | null {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip") || null;
}

/**
 * What wrong passwords are counted under: the login's id, or for an email
 * with no password login, a hash of what was typed (never the text itself:
 * people type passwords into the email box).
 */
export function loginKey(userId: string | null | undefined, typed: string): string {
  return userId ?? `name:${createHash("sha256").update(typed.trim().toLowerCase()).digest("hex")}`;
}

export async function isLockedOut(key: string, address: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000);
  const recent = { action: FAILED, createdAt: { gte: since } };
  const [fromHere, forAccount, fromAddress] = await Promise.all([
    address ? db.auditLog.count({ where: { ...recent, entityId: key, ipAddress: address } }) : Promise.resolve(0),
    db.auditLog.count({ where: { ...recent, entityId: key } }),
    address ? db.auditLog.count({ where: { ...recent, ipAddress: address } }) : Promise.resolve(0),
  ]);
  // With no address to tell places apart, the account's own count is the only one.
  if (!address) return forAccount >= PER_ACCOUNT_AND_ADDRESS;
  return fromHere >= PER_ACCOUNT_AND_ADDRESS || forAccount >= PER_ACCOUNT || fromAddress >= PER_ADDRESS;
}

export async function recordFailedLogin(
  key: string,
  tenantId: string | null | undefined,
  address: string | null,
  via: "web" | "mobile",
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: tenantId ?? undefined,
      action: FAILED,
      // A login's id, or "name:" and the hash of an email nobody signs in with by password.
      entityType: "USER",
      entityId: key,
      ipAddress: address ?? undefined,
      changes: { via },
    },
  });
}
