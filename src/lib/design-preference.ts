import { db } from "@/lib/db";
import { parseDesign, type Design } from "@/lib/design-switch";

/**
 * A person's saved design, read and written by id: their own row only, since
 * every caller passes the signed-in user's id and nothing else.
 *
 * <p>Both calls fail soft. The design is how the product looks, never whether
 * it works, so a database hiccup here costs the saved choice (the default
 * design is shown, and the switch still works for this browser), never a
 * sign in or a page.
 */

export async function savedDesign(userId: string): Promise<Design | null> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { designPreference: true } });
    return parseDesign(user?.designPreference);
  } catch {
    return null;
  }
}

export async function saveDesign(userId: string, design: Design): Promise<boolean> {
  try {
    await db.user.update({ where: { id: userId }, data: { designPreference: design } });
    return true;
  } catch {
    return false;
  }
}
