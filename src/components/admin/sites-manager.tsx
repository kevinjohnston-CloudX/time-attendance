"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2, X } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { createSite, updateSite } from "@/actions/admin.actions";
import type { Site } from "@prisma/client";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  LinkButton,
  Select,
  Table,
  TBody,
  THead,
  TR,
  TH,
  TD,
  TableFooter,
  Toolbar,
  statusTone,
} from "@/components/ui";

/**
 * Sites, on the design's list template: a toolbar carrying the count and the
 * one page action, then the table in a padding-free card.
 *
 * <p>The design's Sites list also carries Code, Employees and Timeclocks
 * columns. A Site here has no code and no device records, and the head count
 * is not loaded on this screen — so those three are left out rather than
 * filled with a dash that looks like a zero.
 *
 * <p>Editing stays in a dialog. Every row on this screen is one building's
 * time zone, and a form that opens underneath a list pushes the row you were
 * reading off the screen while you type into it.
 */

interface Props { sites: Site[] }

/** Field grid from the design's doc template, at two columns. */
const FIELD_GRID = "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,max(200px,48%)),1fr))]";

/**
 * A labelled Select. The kit's Input carries its own label and the design puts
 * the same 12px label over both controls, so this is the select half of that
 * pair rather than a second style of field.
 */
function SelectField({
  label,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="wms-label">{label}</span>
      <Select {...rest}>{children}</Select>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ta-modal max-h-[90vh] w-full max-w-lg overflow-y-auto"
        style={{ borderRadius: "var(--radius-l)" }}
      >
        <header
          className="flex items-center justify-between gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--stroke-divider)" }}
        >
          <h3 style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }}>{title}</h3>
          <Button hierarchy="tertiary" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Submit / cancel, over the divider the design puts at the foot of a form. */
function FormActions({
  submitLabel,
  pending,
  onCancel,
}: {
  submitLabel: string;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-5 flex gap-2 pt-4" style={{ borderTop: "1px solid var(--stroke-divider)" }}>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      <Button type="button" hierarchy="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

export function SitesManager({ sites }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function openEdit(site: Site) { setEditingSite(site); setError(null); }
  function closeEdit() { setEditingSite(null); setError(null); }
  function openCreate() { setShowCreate(true); setError(null); }
  function closeCreate() { setShowCreate(false); setError(null); }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createSite({
        name: fd.get("name") as string,
        timezone: (fd.get("timezone") as string) || "America/New_York",
        address: (fd.get("address") as string) || undefined,
      });
      if (!result.success) { setError(result.error); return; }
      closeCreate();
      router.refresh();
    });
  }

  function handleUpdate(site: Site, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await updateSite({
        siteId: site.id,
        name: fd.get("name") as string,
        timezone: (fd.get("timezone") as string) || "America/New_York",
        address: (fd.get("address") as string) || undefined,
        isActive: fd.get("isActive") === "true",
      });
      if (!result.success) { setError(result.error); return; }
      closeEdit();
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      <Toolbar count={sites.length} countLabel="site">
        <Button onClick={openCreate}>New Site</Button>
      </Toolbar>

      <Card padding={0}>
        {sites.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No sites"
            body="A site is the building a punch is stamped in. Add the first one to start assigning employees."
            action={<Button size="sm" onClick={openCreate}>New Site</Button>}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Site</TH>
                  <TH>Time Zone</TH>
                  <TH>Address</TH>
                  <TH>Status</TH>
                  <TH align="right" />
                </TR>
              </THead>
              <TBody>
                {sites.map((site) => (
                  <TR key={site.id} onClick={() => openEdit(site)}>
                    <TD style={{ fontWeight: "var(--weight-medium)" }}>{site.name}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>{site.timezone}</TD>
                    <TD style={{ color: "var(--text-secondary)" }}>
                      {site.address || <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                    </TD>
                    <TD>
                      {site.isActive ? (
                        <Badge tone={statusTone("ACTIVE")} size="sm" dot>Active</Badge>
                      ) : (
                        // statusTone answers "warning" for a value it does not
                        // know, and an amber pill on a building nobody clocks
                        // in at reads as something to action. Neutral is
                        // Badge's own default — no local map either way.
                        <Badge size="sm">Inactive</Badge>
                      )}
                    </TD>
                    <TD align="right">
                      {/* An anchor, so the PTO assignments open in a new tab
                          from a list you are working down. The row's own
                          handler opens the editor, which is not what this
                          click means. */}
                      <span onClick={(e) => e.stopPropagation()}>
                        <LinkButton href={`/admin/sites/${site.id}`} hierarchy="secondary" size="sm">
                          Open
                        </LinkButton>
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <TableFooter shown={sites.length} total={sites.length} label={sites.length === 1 ? "site" : "sites"} />
          </>
        )}
      </Card>

      {showCreate && (
        <Modal title="New Site" onClose={closeCreate}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={handleCreate}>
            <div className={FIELD_GRID}>
              <Input label="Name" name="name" required placeholder="e.g. Main Office" />
              <Input label="Timezone" name="timezone" placeholder="e.g. America/New_York" />
              <Input label="Address" name="address" hint="Optional" placeholder="e.g. 123 Main St" />
            </div>
            <FormActions submitLabel="Create" pending={isPending} onCancel={closeCreate} />
          </form>
        </Modal>
      )}

      {editingSite && (
        <Modal title={`Edit: ${editingSite.name}`} onClose={closeEdit}>
          {error && <div className="mb-4"><Banner tone="error" body={error} /></div>}
          <form onSubmit={(e) => handleUpdate(editingSite, e)}>
            <div className={FIELD_GRID}>
              <Input label="Name" name="name" defaultValue={editingSite.name} required />
              <Input label="Timezone" name="timezone" defaultValue={editingSite.timezone} />
              <Input label="Address" name="address" defaultValue={editingSite.address ?? ""} hint="Optional" />
              <SelectField label="Status" name="isActive" defaultValue={editingSite.isActive ? "true" : "false"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </SelectField>
            </div>
            <FormActions submitLabel="Save changes" pending={isPending} onCancel={closeEdit} />
          </form>
        </Modal>
      )}
    </div>
  );
}
