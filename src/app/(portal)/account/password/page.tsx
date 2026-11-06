import { redirect } from "next/navigation";
import { SESSION_ENDED_HREF } from "@/lib/auth.config";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ChangePasswordForm } from "@/components/account/change-password-form";

/**
 * Change Password: your own, from inside the app, by giving the current one.
 * The forced change after a temporary password is a different screen
 * ((auth)/change-password), which asks for no current password because the
 * person was just handed one.
 */
export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(SESSION_ENDED_HREF);
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } });
  return <ChangePasswordForm hasPassword={!!user?.passwordHash} />;
}
