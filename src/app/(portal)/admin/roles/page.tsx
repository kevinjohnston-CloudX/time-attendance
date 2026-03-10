import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getRoles } from "@/actions/role.actions";
import { RolesClient } from "./roles-client";

export default async function RolesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "ROLE_MANAGE")) redirect("/admin");

  const result = await getRoles();
  if (!result.success) redirect("/admin");

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          >
            &larr; Admin
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">
            Roles &amp; Permissions
          </h1>
        </div>
      </div>

      <RolesClient roles={result.data} />
    </div>
  );
}
