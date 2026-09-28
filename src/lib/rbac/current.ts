import { auth } from "@/lib/auth";
import { liveIdentity, type LiveIdentity } from "./identity";

/**
 * The signed-in person's live identity (see identity.ts), for an action
 * that needs their real rank rather than the role in the session, which
 * View as can change.
 */
export async function currentIdentity(): Promise<LiveIdentity | null> {
  const session = await auth();
  return session?.user?.id ? liveIdentity(session.user.id) : null;
}
