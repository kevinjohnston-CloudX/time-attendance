import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { listApiKeys } from "@/actions/api-key.actions";
import { IntegrationsClient } from "@/components/admin/integrations-client";

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "SITE_MANAGE")) redirect("/admin");

  const { tab } = (await searchParams) ?? {};
  const result = await listApiKeys();
  const apiKeys = result.success ? result.data : [];

  return (
    <div>
      <Link href="/admin" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        ← Admin
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Integrations</h1>
      <IntegrationsClient apiKeys={apiKeys} initialTab={tab} />
    </div>
  );
}
