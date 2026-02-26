import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/permissions";
import { getDepartments, getSites } from "@/actions/admin.actions";
import { DepartmentsManager } from "@/components/admin/departments-manager";

export default async function DepartmentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission(session.user.role, "SITE_MANAGE")) redirect("/admin");

  const [deptsResult, sitesResult] = await Promise.all([
    getDepartments(),
    getSites(),
  ]);
  if (!deptsResult.success || !sitesResult.success) redirect("/admin");

  return (
    <div>
      <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Departments</h1>
      <DepartmentsManager departments={deptsResult.data} sites={sitesResult.data} />
    </div>
  );
}
