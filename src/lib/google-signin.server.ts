import "server-only";
import { db } from "@/lib/db";
import { findLoginUserId } from "@/lib/login-lookup";
import { isClientBadge } from "@/lib/utils/client-badge";
import { signInRefused } from "@/lib/microsoft-signin";
import { linkSignInAccount, type SignInAccount } from "@/lib/signin-account.server";

type GoogleProfile = { email?: unknown; email_verified?: unknown } | null | undefined;

/**
 * Whether a Google sign in may go ahead (auth.ts signIn). Null lets it
 * through; otherwise the sign in page address that says why it was refused.
 *
 * <p>Never creates anybody. Only an address Google has confirmed belongs to
 * the account counts (security audit 2026-11), on an allowed domain when the
 * list is set, and it must be one of the two emails HR registered for the
 * person, ignoring capitals. Visitors never sign in.
 *
 * <p>Each of the person's addresses can have its own Google account: the one
 * for their work email and the one for their personal email both sign them
 * in. Until 2026-11-17 only the first was ever tied to them, and the second
 * was refused by the library with a "did not finish" nobody could act on.
 */
export async function googleSignIn(
  profile: GoogleProfile,
  account: SignInAccount,
  allowedDomains: readonly string[],
): Promise<string | null> {
  if (profile?.email_verified !== true || typeof profile.email !== "string") return signInRefused("Refused", "google");
  const email = profile.email.trim();
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) return signInRefused("Refused", "google");

  const userId = await findLoginUserId(email, { email: true });
  if (!userId) return signInRefused("NotSetUp", "google");

  const person = await db.employee.findFirst({ where: { userId }, select: { wmsId: true } });
  if (isClientBadge(person?.wmsId)) return signInRefused("Refused", "google");

  return (await linkSignInAccount(userId, "google", account)) === "ok" ? null : signInRefused("Refused", "google");
}
