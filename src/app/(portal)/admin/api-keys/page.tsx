import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { listApiKeys } from "@/actions/api-key.actions";
import { IntegrationsClient, type IntegrationsTab } from "@/components/admin/integrations-client";

/**
 * Integrations, on the portal design's doc template.
 *
 * <p>The page header is rendered by {@link IntegrationsClient}: "New Key" is a
 * page action in the design and it opens the create form further down, so the
 * header belongs on the same side of the client boundary as that form.
 */
export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "SITE_MANAGE")) redirect("/admin");

  const { tab } = (await searchParams) ?? {};
  const activeTab: IntegrationsTab = tab === "api-docs" ? "api-docs" : "api-keys";

  const result = await listApiKeys();

  return (
    <div className="flex flex-col gap-4">
      <IntegrationsClient
        apiKeys={result.success ? result.data : []}
        tab={activeTab}
        // An empty table and a failed read look identical, and the difference
        // decides whether somebody goes and creates a duplicate key.
        loadError={result.success ? null : result.error}
      />
    </div>
  );
}
