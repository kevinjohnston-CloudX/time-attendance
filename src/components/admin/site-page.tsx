"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "@/components/layout/navigation-progress";
import { ArrowLeft, Check, Palmtree, Pencil } from "lucide-react";
import type { Site } from "@prisma/client";
import { Banner, Button, EmptyState, LinkButton, PageHeader, PinnedBar, Select } from "@/components/ui";
import { updateSite } from "@/actions/admin.actions";
import { assignSitePtoPolicy } from "@/actions/pto-policy.actions";
import { SiteDialog } from "./sites-manager";
import { AreaPanel, LEAVE_CATEGORY_LABEL, StatusBadge, saveError } from "./setup/setup-ui";
import { timeZoneLabel } from "./setup/time-zones";

/**
 * A site's own page: who it is in the header, with Edit site, and the leave
 * policy each leave type follows here.
 *
 * <p>A policy saves the moment it is picked, as before, and says so on its
 * row; picking No site policy clears it. Only that row waits while it saves.
 */
export function SitePage({
  site,
  leaveTypes,
  policies,
  assignments,
}: {
  site: Site;
  leaveTypes: { id: string; name: string; category: string }[];
  policies: { id: string; name: string }[];
  assignments: { leaveTypeId: string; ptoPolicyId: string }[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(() => new Map(assignments.map((a) => [a.leaveTypeId, a.ptoPolicyId])));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editPending, startEdit] = useTransition();

  function assign(leaveTypeId: string, ptoPolicyId: string | null) {
    setSavingId(leaveTypeId);
    setSavedId(null);
    setError(null);
    startTransition(async () => {
      const result = await assignSitePtoPolicy({ siteId: site.id, leaveTypeId, ptoPolicyId });
      if (!result.success) {
        setError(saveError(result.error));
      } else {
        setPicked((prev) => {
          const next = new Map(prev);
          if (ptoPolicyId) next.set(leaveTypeId, ptoPolicyId);
          else next.delete(leaveTypeId);
          return next;
        });
        setSavedId(leaveTypeId);
        router.refresh();
      }
      setSavingId(null);
    });
  }

  function saveSite(form: FormData) {
    setEditError(null);
    startEdit(async () => {
      const result = await updateSite({
        siteId: site.id,
        name: String(form.get("name") ?? "").trim(),
        timezone: String(form.get("timezone") ?? "") || "America/New_York",
        address: String(form.get("address") ?? ""),
        isActive: form.get("isActive") === "true",
      });
      if (!result.success) return setEditError(saveError(result.error));
      setEditing(false);
      router.refresh();
    });
  }

  const setCount = leaveTypes.filter((lt) => picked.has(lt.id)).length;

  return (
    <div className="flex flex-col gap-4">
      <PinnedBar>
        <PageHeader
          title={
            <span className="inline-flex min-w-0 items-center gap-3">
              <span className="truncate">{site.name}</span>
              <StatusBadge active={site.isActive} />
            </span>
          }
          subtitle={[timeZoneLabel(site.timezone), site.address].filter(Boolean).join(" · ")}
          actions={
            <>
              <LinkButton
                href="/admin/site-settings?tab=sites"
                hierarchy="tertiary"
                leadingIcon={<ArrowLeft className="h-4 w-4" />}
              >
                Company Setup
              </LinkButton>
              <Button hierarchy="secondary" leadingIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit site
              </Button>
            </>
          }
        />
      </PinnedBar>

      <div className="flex w-full max-w-[960px] flex-col gap-4">
        {error && <Banner tone="error" title="The policy was not saved" body={error} />}

        <AreaPanel
          title="Leave policies"
          hint="The accrual policy each leave type follows for people at this site. Anyone with a policy of their own keeps it."
          action={
            leaveTypes.length ? (
              <span className="tabular whitespace-nowrap" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {setCount} of {leaveTypes.length} set
              </span>
            ) : undefined
          }
        >
          {leaveTypes.length === 0 ? (
            <EmptyState
              icon={<Palmtree className="h-8 w-8" />}
              title="No active leave types"
              body="Add a leave type in Company Setup, then pick its policy here."
              action={
                <LinkButton href="/admin/site-settings?tab=leave-types" hierarchy="secondary" size="sm">
                  Open leave types
                </LinkButton>
              }
            />
          ) : (
            <>
              {policies.length === 0 && (
                <div className="px-5 pt-4">
                  <Banner
                    tone="info"
                    title="No active leave policies yet"
                    body="Create one in Rules Setup, then pick it here."
                    actions={
                      <LinkButton href="/admin/rules-setup?tab=leave-policies" size="sm" hierarchy="secondary">
                        Open leave policies
                      </LinkButton>
                    }
                  />
                </div>
              )}
              <ul className="m-0 list-none p-0">
                {leaveTypes.map((lt) => {
                  const saving = savingId === lt.id;
                  return (
                    <li
                      key={lt.id}
                      className="grid items-center gap-x-4 gap-y-2 px-5 py-3 [grid-template-columns:minmax(0,1fr)_minmax(220px,340px)_72px]"
                      style={{ borderBottom: "1px solid var(--stroke-divider)" }}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span
                          className="truncate"
                          style={{ font: "var(--type-body1)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}
                        >
                          {lt.name}
                        </span>
                        {/* The category, unless it only repeats the name. */}
                        {(LEAVE_CATEGORY_LABEL[lt.category] ?? lt.category).toLowerCase() !== lt.name.toLowerCase() && (
                          <span style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                            {LEAVE_CATEGORY_LABEL[lt.category] ?? lt.category}
                          </span>
                        )}
                      </span>
                      <Select
                        aria-label={`Leave policy for ${lt.name}`}
                        value={picked.get(lt.id) ?? ""}
                        disabled={saving}
                        onChange={(e) => assign(lt.id, e.target.value || null)}
                        style={{ width: "100%" }}
                      >
                        <option value="">No site policy</option>
                        {policies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                      <span
                        className="inline-flex items-center gap-1 whitespace-nowrap"
                        aria-live="polite"
                        style={{ font: "var(--type-caption1)", color: saving ? "var(--text-tertiary)" : "var(--text-success)" }}
                      >
                        {saving ? (
                          "Saving…"
                        ) : savedId === lt.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            Saved
                          </>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="m-0 px-5 py-3" style={{ font: "var(--type-caption1)", color: "var(--text-tertiary)" }}>
                A leave type with no site policy uses the company default. Changes save as soon as you pick.{" "}
                <Link href="/admin/rules-setup?tab=leave-policies" style={{ color: "var(--text-accent)" }}>
                  Manage leave policies
                </Link>
              </p>
            </>
          )}
        </AreaPanel>
      </div>

      {editing && (
        <SiteDialog
          site={site}
          pending={editPending}
          error={editError}
          onSubmit={saveSite}
          onClose={() => {
            setEditing(false);
            setEditError(null);
          }}
        />
      )}
    </div>
  );
}
