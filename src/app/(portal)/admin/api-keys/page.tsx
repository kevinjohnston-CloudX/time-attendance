import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { userHasPermission } from "@/lib/rbac/check-permission";
import { listApiKeys } from "@/actions/api-key.actions";
import { listWebhooks } from "@/actions/webhook.actions";
import { IntegrationsClient, type IntegrationsTab } from "@/components/admin/integrations-client";
import type { DocSection } from "@/components/admin/api-documentation";

/**
 * Integrations. Company admins (SITE_MANAGE) manage the company's API keys
 * and webhooks and read the external API reference; the screen is
 * IntegrationsClient, and this only gates it and loads the keys (and, on the
 * Webhooks tab, the webhooks).
 *
 * <p>The base URL a vendor is given is the address this page was opened on,
 * read here rather than in the browser so the first paint already has it.
 */
export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; open?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!await userHasPermission(session.user, "SITE_MANAGE")) redirect("/admin");

  const sp = (await searchParams) ?? {};
  const activeTab: IntegrationsTab = sp.tab === "api-docs" ? "api-docs" : sp.tab === "webhooks" ? "webhooks" : "api-keys";
  const openSection = (["auth", "lt", "pto", "people", "person", "webhooks"] as const satisfies readonly DocSection[]).find((s) => s === sp.open);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-domain.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");

  const result = await listApiKeys();
  const hooks = activeTab === "webhooks" ? await listWebhooks() : null;

  return (
    <IntegrationsClient
      apiKeys={result.success ? result.data : []}
      webhooks={
        hooks
          ? hooks.success
            ? { hooks: hooks.data.endpoints, ready: hooks.data.ready, note: hooks.data.note, error: null }
            : { hooks: [], ready: false, note: null, error: hooks.error }
          : undefined
      }
      tab={activeTab}
      // An empty table and a failed read look identical, and the difference
      // decides whether somebody goes and creates a duplicate key.
      loadError={result.success ? null : result.error}
      baseUrl={`${proto.split(",")[0]}://${host.split(",")[0]}`}
      openSection={openSection}
    />
  );
}
