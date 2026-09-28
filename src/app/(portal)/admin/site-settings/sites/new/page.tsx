import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { CreateSiteClient } from "./create-site-client";

export default async function NewSitePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const hasSiteManage = await userHasPermission(session.user, "SITE_MANAGE");
  if (!hasSiteManage) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=sites" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Sites
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">New Site</h1>
      <CreateSiteClient />
    </div>
  );
}
