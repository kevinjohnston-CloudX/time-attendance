import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Change password is the forced change after a temporary password, and
 * nothing else: opened by its address from any signed-in screen it set a new
 * password without the current one. Anyone not being made to change goes back
 * to the app; changePassword refuses them too.
 */
export default async function ChangePasswordLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.mustChangePassword) redirect("/dashboard");
  return children;
}
