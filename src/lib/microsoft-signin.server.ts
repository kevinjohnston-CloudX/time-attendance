import "server-only";
import { db } from "@/lib/db";
import { findLoginUserId } from "@/lib/login-lookup";
import { isClientBadge } from "@/lib/utils/client-badge";
import { MICROSOFT_PROVIDER, microsoftAddresses, signInRefused } from "@/lib/microsoft-signin";

type MicrosoftAccount = {
  providerAccountId?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
};

/**
 * Whether a Microsoft sign in may go ahead (auth.ts signIn). Null lets it
 * through; otherwise the sign in page address that says why it was refused.
 *
 * <p>Never creates anybody. The person must already be in CloudTime under
 * the verified sign in name, or a same domain email claim, as their email or
 * work email (lib/microsoft-signin.ts). Visitors never sign in.
 *
 * <p>The first sign in links the Microsoft account to that person, and from
 * then on it is theirs alone: an account already linked to somebody else is
 * refused here, even if the addresses now point at this person, so a renamed
 * or reused address can never carry one person's Microsoft account into
 * another person's CloudTime.
 */
export async function microsoftSignIn(profile: unknown, account: MicrosoftAccount): Promise<string | null> {
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

  const key = { provider: MICROSOFT_PROVIDER, providerAccountId: account.providerAccountId };
  const linked = await db.account.findUnique({ where: { provider_providerAccountId: key }, select: { userId: true } });
  if (linked && linked.userId !== userId) return signInRefused("Refused", "microsoft");
  if (!linked) {
    // Linked now, so the library finds this person by the account rather
    // than creating a new one or refusing it as not linked.
    await db.account.create({
      data: {
        userId,
        type: "oauth",
        ...key,
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_at: account.expires_at,
        token_type: account.token_type,
        scope: account.scope,
        id_token: account.id_token,
      },
    });
  }
  return null;
}
