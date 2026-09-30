import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getSites } from "@/actions/admin.actions";
import { CreateDepartmentClient } from "./create-department-client";

export default async function NewDepartmentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasSiteManage = await userHasPermission(session.user, "SITE_MANAGE");
  if (!hasSiteManage) redirect("/dashboard");

  const result = await getSites();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
  const sites = result.success ? result.data : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=departments" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Departments
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Department</h1>
      <CreateDepartmentClient sites={serialize(sites)} />
    </div>
  );
}
