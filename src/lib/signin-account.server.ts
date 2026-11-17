import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type SignInAccount = {
  providerAccountId?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
};

/**
 * Ties a Google or Microsoft account to the CloudTime person it signs in as
 * (auth.ts signIn), and says whether the sign in may go on.
 *
 * <p>A person may have several: a Google account for their work email and
 * another for their personal one, each matched to them by an address Google
 * or Microsoft has confirmed. Each account belongs to one person only. One
 * already tied to somebody else is refused, even if the addresses now point
 * here, so a renamed or reused address never carries one person's account
 * into another person's CloudTime.
 *
 * <p>Tied here, before the library looks the account up, so the library
 * finds this person by the account rather than refusing it as unlinked.
 */
export async function linkSignInAccount(
  userId: string,
  provider: string,
  account: SignInAccount,
): Promise<"ok" | "taken"> {
  if (!account.providerAccountId) return "taken";
  const key = { provider, providerAccountId: account.providerAccountId };
  const owner = async () =>
    (await db.account.findUnique({ where: { provider_providerAccountId: key }, select: { userId: true } }))?.userId ?? null;

  const linkedTo = await owner();
  if (linkedTo) return linkedTo === userId ? "ok" : "taken";
  try {
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
    return "ok";
  } catch (e) {
    // Two tabs signing in at once: the other one tied it first. Whose it is
    // now decides, exactly as if this one had come second.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return (await owner()) === userId ? "ok" : "taken";
    }
    throw e;
  }
}
