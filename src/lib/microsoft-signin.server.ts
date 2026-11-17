import "server-only";
import { db } from "@/lib/db";
import { findLoginUserId } from "@/lib/login-lookup";
import { isClientBadge } from "@/lib/utils/client-badge";
import { MICROSOFT_PROVIDER, microsoftAddresses, signInRefused } from "@/lib/microsoft-signin";
import { linkSignInAccount, type SignInAccount } from "@/lib/signin-account.server";

/**
 * Whether a Microsoft sign in may go ahead (auth.ts signIn). Null lets it
 * through; otherwise the sign in page address that says why it was refused.
 *
 * <p>Never creates anybody. The person must already be in CloudTime under
 * the verified sign in name, or a same domain email claim, as their email or
 * work email (lib/microsoft-signin.ts). Visitors never sign in.
 *
 * <p>The first sign in ties the Microsoft account to that person, and from
 * then on it is theirs alone (lib/signin-account.server.ts).
 */
export async function microsoftSignIn(profile: unknown, account: SignInAccount): Promise<string | null> {
  const addresses = microsoftAddresses(profile as { preferred_username?: unknown; email?: unknown });
  if (!addresses || !account.providerAccountId) return signInRefused("Refused", "microsoft");

  let userId: string | null = null;
  for (const address of addresses) {
    userId = await findLoginUserId(address, { email: true });
    if (userId) break;
  }
  if (!userId) return signInRefused("NotSetUp", "microsoft");

  const person = await db.employee.findFirst({ where: { userId }, select: { wmsId: true } });
  if (isClientBadge(person?.wmsId)) return signInRefused("Refused", "microsoft");

  return (await linkSignInAccount(userId, MICROSOFT_PROVIDER, account)) === "ok" ? null : signInRefused("Refused", "microsoft");
}
