import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { getSites } from "@/actions/admin.actions";
import { EditSiteClient } from "./edit-site-client";

export default async function EditSitePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const hasSiteManage = await userHasPermission(session.user, "SITE_MANAGE");
  if (!hasSiteManage) redirect("/dashboard");

  const { id } = await params;
  const result = await getSites();
  const sites = result.success ? result.data : [];
  const site = sites.find((s) => s.id === id);
  if (!site) redirect("/admin/site-settings?tab=sites");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function serialize<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/admin/site-settings?tab=sites" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Sites
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">{site.name}</h1>
      <EditSiteClient site={serialize(site)} />
    </div>
  );
}
