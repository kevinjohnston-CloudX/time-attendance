"use client";

import { useState } from "react";
import {
  Banner,
  Button,
  Card,
  LinkButton,
  PageHeader,
  PinnedBar,
  SegmentedLinks,
} from "@/components/ui";
import { ApiKeysManager } from "@/components/admin/api-keys-manager";
import { ApiDocumentation } from "@/components/admin/api-documentation";

/**
 * Integrations, on the portal design's doc template: the warning about what a
 * key is, then the keys themselves.
 *
 * <p>The two panes are links, not local state. `?tab=api-docs` was already in
 * the URL contract — the server page reads it — but it was only ever an initial
 * value, so clicking the second pane left the address bar claiming you were on
 * the first. As anchors, the docs pane can be linked to and reloaded, which
 * matters because the API documentation is the thing people paste to a vendor.
 *
 * <p>This component owns the page header as well. "New Key" is a page action in
 * the design and it opens the create form inside {@link ApiKeysManager}, so the
 * form's open state is held here and passed down rather than being reached into
 * from a server-rendered header.
 */

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  isActive: boolean;
};

export type IntegrationsTab = "api-keys" | "api-docs";

const TABS: { value: IntegrationsTab; label: string; href: string }[] = [
  { value: "api-keys", label: "API Keys", href: "/admin/api-keys" },
  { value: "api-docs", label: "API Documentation", href: "/admin/api-keys?tab=api-docs" },
];

interface Props {
  apiKeys: ApiKey[];
  tab: IntegrationsTab;
  /** Set when the key list could not be read, so an empty table is not read as "no keys". */
  loadError?: string | null;
}

export function IntegrationsClient({ apiKeys, tab, loadError }: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PinnedBar>
        <PageHeader
          title="Integrations"
          subtitle="Keys used by timeclocks and exports"
          actions={
            <>
              <LinkButton href="/admin" hierarchy="tertiary">
                ← Administration
              </LinkButton>
              {/* Only on the keys pane — a "New Key" button above the API
                  reference would generate something you cannot see. */}
              {tab === "api-keys" && (
                <Button hierarchy="primary" onClick={() => setCreateOpen(true)}>
                  New Key
                </Button>
              )}
            </>
          }
        />
        <SegmentedLinks items={TABS} active={tab} ariaLabel="Integrations view" />
      </PinnedBar>

      <div className="flex flex-col gap-4">
        {loadError && (
          <Banner tone="error" title="Could not load the API keys" body={loadError} />
        )}

        {tab === "api-keys" ? (
          <>
            <Banner
              tone="warning"
              title="A key is shown once, at creation"
              body="Every key here unlocks this company's whole external API — there is no per-site or read-only scope. Rotate a key rather than sharing one, and revoke anything you cannot account for."
            />
            <ApiKeysManager
              apiKeys={apiKeys}
              createOpen={createOpen}
              onCreateOpenChange={setCreateOpen}
            />
          </>
        ) : (
          <Card
            title="External REST API"
            subtitle="Authentication, endpoints and example requests for the integrations above"
          >
            <ApiDocumentation />
          </Card>
        )}
      </div>
    </>
  );
}
