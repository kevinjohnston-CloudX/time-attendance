"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight, Link2, Plus, ShieldCheck } from "lucide-react";
import {
  Banner,
  Button,
  LinkButton,
  PageHeader,
  PinnedBar,
  SegmentedControl,
  SegmentedLinks,
} from "@/components/ui";
import { useCondensingBar } from "@/components/layout/use-condensing-bar";
import { ApiKeysManager, type ApiKey, type KeyFilter } from "@/components/admin/api-keys-manager";
import { ApiDocumentation, CopyButton, MethodBadge, type DocSection } from "@/components/admin/api-documentation";

/**
 * Integrations, from the page handoff: a pinned title and toolbar (the two
 * tabs, then the Status filter on the keys tab or the base URL on the docs
 * tab), the key warning and the key list, and a Connect panel with what a
 * vendor needs besides the key.
 *
 * <p>The two tabs are links, not local state, so the docs tab can be linked
 * to and reloaded: it is the page people send a vendor. The Connect panel's
 * endpoints link straight to their section of it (`&open=lt`).
 *
 * <p>This component owns the page header as well. "New Key" is a page action
 * in the design and it opens the form inside ApiKeysManager, so the form's
 * open state is held here and passed down.
 */

export type IntegrationsTab = "api-keys" | "api-docs";

const TABS: { value: IntegrationsTab; label: string; href: string }[] = [
  { value: "api-keys", label: "API Keys", href: "/admin/api-keys" },
  { value: "api-docs", label: "API Documentation", href: "/admin/api-keys?tab=api-docs" },
];

const PANEL: CSSProperties = { background: "var(--surface-card)", borderRadius: 18, boxShadow: "var(--ta-shell-shadow)" };
const MONO = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const EYEBROW: CSSProperties = {
  font: "var(--weight-semibold) 11px/14px var(--font-sans)",
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};
const WELL: CSSProperties = { borderRadius: 10, background: "var(--ta-well)", boxShadow: "inset 0 0 0 1px var(--ta-well-ring)" };

function CopyLink({ href }: { href: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(href).then(
          () => {
            setDone(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setDone(false), 1800);
          },
          () => {}
        )
      }
      className="ta-tool-trigger"
      style={{ border: 0, background: "transparent", cursor: "pointer", padding: "0 12px" }}
    >
      <Link2 className="h-[15px] w-[15px]" aria-hidden />
      {done ? "Link copied" : "Copy link"}
    </button>
  );
}

export function IntegrationsClient({
  apiKeys,
  tab,
  loadError,
  baseUrl,
  openSection,
}: {
  apiKeys: ApiKey[];
  tab: IntegrationsTab;
  /** Set when the key list could not be read, so an empty table is not read as "no keys". */
  loadError?: string | null;
  /** The address the page was opened on, for the base URL and the examples. */
  baseUrl: string;
  /** The docs section to open on arrival, from a Connect panel link. */
  openSection?: DocSection;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<KeyFilter>("all");
  const { barRef, markerRef, condensed, barHeight } = useCondensingBar();

  const apiBase = `${baseUrl}/api/external`;
  const active = apiKeys.filter((k) => k.isActive).length;
  const onKeys = tab === "api-keys";

  return (
    <div className="relative flex flex-col gap-3.5">
      <span ref={markerRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-px w-px" />
      <PinnedBar barRef={barRef}>
        <PageHeader
          title="Integrations"
          subtitle="API keys for time clocks and exports"
          condensed={condensed}
          actions={
            <>
              <LinkButton href="/admin" hierarchy="tertiary" leadingIcon={<ArrowLeft className="h-4 w-4" />}>
                Administration
              </LinkButton>
              {/* Only on the keys tab. A "New Key" button above the API
                  reference would make something you cannot see. */}
              {onKeys && (
                <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                  New Key
                </Button>
              )}
            </>
          }
        />
        <div
          className="flex min-h-12 flex-wrap items-center gap-2 py-1.5 pl-2 pr-1.5"
          style={{ background: "var(--surface-card)", borderRadius: 14, boxShadow: "var(--ta-toolbar-shadow)" }}
        >
          <SegmentedLinks items={TABS} active={tab} ariaLabel="Integrations view" />
          <span className="flex-1" />
          {onKeys ? (
            <span className="flex items-center gap-2">
              <span className="whitespace-nowrap" style={{ font: "var(--weight-medium) 13px/1 var(--font-sans)", color: "var(--text-tertiary)" }}>
                Status
              </span>
              <SegmentedControl
                size="sm"
                ariaLabel="Key status"
                value={filter}
                onChange={(v) => setFilter(v as KeyFilter)}
                items={[
                  { value: "all", label: `All ${apiKeys.length}` },
                  { value: "active", label: `Active ${active}` },
                  { value: "revoked", label: `Revoked ${apiKeys.length - active}` },
                ]}
              />
            </span>
          ) : (
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="flex h-[34px] min-w-0 items-center gap-2 pl-3 pr-1" style={WELL}>
                <span className="whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  Base URL
                </span>
                <code className="min-w-0 truncate" style={{ fontFamily: MONO, fontSize: 12, color: "var(--text-primary)" }}>
                  {apiBase}
                </code>
                <CopyButton text={apiBase} label="Copy base URL" iconOnly />
              </span>
              <CopyLink href={`${baseUrl}/admin/api-keys?tab=api-docs`} />
            </span>
          )}
        </div>
      </PinnedBar>

      {loadError && (
        <Banner
          tone="error"
          title="Could not load the API keys"
          body="The key list could not be read. Reload the page to try again. An empty table here doesn't mean there are no keys."
        />
      )}

      {onKeys ? (
        <div className="flex flex-wrap items-start gap-3.5">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
            <div className="flex items-start gap-3.5 py-3.5 pl-3.5 pr-[18px]" style={{ ...PANEL, borderRadius: 16 }}>
              <span
                className="grid h-[38px] w-[38px] flex-none place-items-center"
                style={{ borderRadius: 11, background: "var(--surface-warning)", boxShadow: "inset 0 0 0 1px var(--stroke-warning)", color: "var(--icon-warning)" }}
              >
                <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[3px] pt-px">
                <span style={{ font: "var(--weight-semibold) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>A key is shown once, at creation</span>
                <span style={{ font: "var(--type-body2)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                  Each key gives full access to this company&apos;s external API. Keys can&apos;t be limited to one site or made read only. Give every
                  integration its own key, and revoke any you don&apos;t recognize.
                </span>
              </span>
            </div>
            <ApiKeysManager apiKeys={apiKeys} filter={filter} createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
          </div>

          <aside className="flex max-w-full flex-[1_1_300px] flex-col gap-3.5">
            <section className="px-4 pb-3.5 pt-4" style={PANEL}>
              <div style={{ font: "var(--weight-semibold) 15px/20px var(--font-sans)", color: "var(--text-primary)" }}>Connect</div>
              <div className="mt-0.5" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
                What a vendor needs, besides the key.
              </div>

              <div className="mt-3.5" style={EYEBROW}>Base URL</div>
              <div className="mt-1.5 flex h-9 items-center gap-2 pl-3 pr-1" style={WELL}>
                <code className="min-w-0 flex-1 truncate" title={apiBase} style={{ fontFamily: MONO, fontSize: 12, color: "var(--text-primary)" }}>
                  {apiBase}
                </code>
                <CopyButton text={apiBase} label="Copy base URL" iconOnly />
              </div>

              <div className="mt-3" style={EYEBROW}>Header</div>
              <div className="mt-1.5 flex h-9 items-center gap-2 pl-3 pr-1" style={WELL}>
                <code className="min-w-0 flex-1 truncate" style={{ fontFamily: MONO, fontSize: 12, color: "var(--text-primary)" }}>
                  Authorization: Bearer ta_…
                </code>
                <CopyButton text="Authorization: Bearer ta_" label="Copy header" iconOnly />
              </div>

              <div className="mt-3.5" style={EYEBROW}>Endpoints</div>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {(
                  [
                    { id: "lt", method: "GET", label: "List Leave Types", path: "/leave-types" },
                    { id: "pto", method: "POST", label: "Submit a Leave Request", path: "/pto-requests" },
                  ] as const
                ).map((e) => (
                  <Link
                    key={e.id}
                    href={`/admin/api-keys?tab=api-docs&open=${e.id}`}
                    className="ta-hoverable flex items-center gap-2.5 p-2"
                    style={{ borderRadius: 10, textDecoration: "none" }}
                  >
                    <MethodBadge method={e.method} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate" style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: "var(--text-primary)" }}>
                        {e.label}
                      </span>
                      <code style={{ fontFamily: MONO, fontSize: 11, color: "var(--text-tertiary)" }}>{e.path}</code>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 flex-none" aria-hidden style={{ color: "var(--icon-disabled)" }} />
                  </Link>
                ))}
              </div>

              <Link
                href="/admin/api-keys?tab=api-docs"
                className="ta-hoverable mt-2.5 flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap"
                style={{ borderRadius: 10, background: "var(--ta-well)", font: "var(--weight-medium) 13px/1 var(--font-sans)", color: "var(--text-accent)", textDecoration: "none" }}
              >
                Read the API documentation
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </section>
          </aside>
        </div>
      ) : (
        <ApiDocumentation key={openSection ?? "none"} baseUrl={baseUrl} initialOpen={openSection} stickyTop={barHeight} />
      )}
    </div>
  );
}
