"use server";

import { auth } from "@/lib/auth";
import { getMyProfile, type MyProfile } from "@/lib/account/my-profile.service";

/**
 * My profile: the signed in person's own details, badge and sign in.
 *
 * <p>Open to anyone signed in, deliberately, because it only ever returns the
 * caller's own record: it takes no id at all, and both ids come from the
 * session. View as changes what a role may open, never who you are, so it
 * shows your own record then too.
 */
export async function loadMyProfile(): Promise<{ success: true; data: MyProfile } | { success: false; message: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, message: "Your session has ended. Sign in again." };
  try {
    const profile = await getMyProfile(session.user.id, session.user.employeeId);
    if (!profile) return { success: false, message: "Your profile could not be found. Sign in again." };
    return { success: true, data: profile };
  } catch (err) {
    console.error("[profile] load failed", err instanceof Error ? err.message : err);
    return { success: false, message: "Your profile could not be opened. Try again." };
  }
}
