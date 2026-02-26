import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getSites } from "@/actions/admin.actions";
import { SitesManager } from "@/components/admin/sites-manager";

export default async function SitesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "SITE_MANAGE")) redirect("/admin");

  const result = await getSites();
  if (!result.success) redirect("/admin");

  return (
    <div>
      <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Sites</h1>
      <SitesManager sites={result.data} />
    </div>
  );
}
