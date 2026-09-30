import { auth } from "@/lib/auth";
import { liveIdentity, type LiveIdentity } from "./identity";
import { validViewAsId, viewAsRank } from "./check-permission";

/**
 * The signed-in person's live identity (see identity.ts), for an action that
 * needs their rank. Read from the database rather than the session. While
 * they View as a role, the rank is that role's: View as only ever accepts a
 * role below the person's own, so this can lower their reach, never raise it.
 */
export async function currentIdentity(): Promise<LiveIdentity | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const me = await liveIdentity(session.user.id);
  if (!me) return null;
  const viewAsId = await validViewAsId(session.user);
  if (!viewAsId) return me;
  return { ...me, isSuperAdmin: false, rank: await viewAsRank(viewAsId) };
}
