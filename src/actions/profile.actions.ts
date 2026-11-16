"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
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

/**
 * Turns the person's own approval emails on or off (lib/notify). Phone
 * alerts are not affected.
 *
 * <p>Open to anyone signed in, like loading the profile, because it only ever
 * changes the caller's own sign in: it takes no id, the one it writes comes
 * from the session.
 */
export async function setApprovalEmails(on: boolean): Promise<{ success: true } | { success: false; message: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, message: "Your session has ended. Sign in again." };
  if (typeof on !== "boolean") return { success: false, message: "That setting could not be saved. Try again." };
  try {
    await db.user.update({ where: { id: session.user.id }, data: { approvalEmails: on } });
    return { success: true };
  } catch (err) {
    console.error("[profile] approval emails not saved", err instanceof Error ? err.message : err);
    return { success: false, message: "That setting could not be saved. Try again." };
  }
}
