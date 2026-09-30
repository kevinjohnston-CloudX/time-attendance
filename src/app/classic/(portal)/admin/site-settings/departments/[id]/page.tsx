import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getDepartments, getSites } from "@/actions/admin.actions";
import { EditDepartmentClient } from "./edit-department-client";

export default async function EditDepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const hasSiteManage = await userHasPermission(session.user, "SITE_MANAGE");
  if (!hasSiteManage) redirect("/dashboard");

  const { id } = await params;

  const [deptsResult, sitesResult] = await Promise.all([getDepartments(), getSites()]);
  const departments = deptsResult.success ? deptsResult.data : [];
  const sites = sitesResult.success ? sitesResult.data : [];
  const department = departments.find((d) => d.id === id);
  if (!department) redirect("/admin/site-settings?tab=departments");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=departments" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Departments
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{department.name}</h1>
      <EditDepartmentClient department={serialize(department)} sites={serialize(sites)} />
    </div>
  );
}
