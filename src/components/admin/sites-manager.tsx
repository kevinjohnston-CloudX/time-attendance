"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "@/components/layout/navigation-progress";
import { Building2, ChevronRight, Plus } from "lucide-react";
import { createSite, updateSite } from "@/actions/admin.actions";
import type { Site } from "@prisma/client";
import { Button, EmptyState, Input, LinkButton, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import {
  AreaPanel,
  Muted,
  SelectField,
  SetupDialog,
  StatusBadge,
  StatusField,
  countLine,
  matches,
  saveError,
  useStatusView,
  useOpenFromLink,
} from "./setup/setup-ui";
import { timeZoneLabel, timeZoneOptions } from "./setup/time-zones";

/**
 * Sites: the buildings people clock in at, each with the time zone its
 * punches are stamped in.
 *
 * <p>A row opens the edit window, the same as every Company Setup area. The
 * leave policies a site hands out live on the site's own page, reached from
 * Leave policies on the row.
 */

export function SitesManager({ sites }: { sites: Site[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Site | "new" | null>(null);
  const [query, setQuery] = useState("");
  const { view, setView, counts, kept } = useStatusView(sites);
  const shown = kept.filter((s) => matches(query, s.name, s.address, s.timezone, timeZoneLabel(s.timezone)));

  function open(site: Site | "new") {
    setEditing(site);
    setError(null);
  }
  // A link from elsewhere (an employee record, a classic address) opens its record.
  useOpenFromLink(sites, open);
  function close() {
    setEditing(null);
    setError(null);
  }

  function save(form: FormData) {
    const fields = {
      name: String(form.get("name") ?? "").trim(),
      timezone: String(form.get("timezone") ?? "") || "America/New_York",
      address: String(form.get("address") ?? ""),
    };
    setError(null);
    startTransition(async () => {
      const result =
        editing === "new"
          ? await createSite(fields)
          : await updateSite({ ...fields, siteId: (editing as Site).id, isActive: form.get("isActive") === "true" });
      if (!result.success) return setError(saveError(result.error));
      close();
      router.refresh();
    });
  }

  const addButton = (
    <Button onClick={() => open("new")} leadingIcon={<Plus className="h-4 w-4" />}>
      Add site
    </Button>
  );

  return (
    <>
      <AreaPanel
        title="Sites"
        hint="The buildings people clock in at. The time zone decides how their punches are stamped."
        action={addButton}
        status={{ view, onChange: setView, counts }}
        search={sites.length ? { value: query, onChange: setQuery, placeholder: "Site, address or time zone" } : undefined}
        count={countLine(shown.length, sites.length, "site", "sites")}
      >
        {sites.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No sites yet"
            body="Add the first building, then assign employees to it."
            action={addButton}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-8 w-8" />}
            title="No sites match"
            body={query ? "Nothing matches that search in this view." : "There are no sites in this view."}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Site</TH>
                <TH>Time zone</TH>
                <TH>Address</TH>
                <TH>Status</TH>
                <TH align="right">
                  <span className="sr-only">Leave policies</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((site) => (
                <TR key={site.id} onClick={() => open(site)}>
                  <TD style={{ fontWeight: "var(--weight-medium)" }}>{site.name}</TD>
                  <TD style={{ color: "var(--text-secondary)" }} title={site.timezone}>
                    {timeZoneLabel(site.timezone)}
                  </TD>
                  <TD style={{ color: "var(--text-secondary)" }}>{site.address || <Muted>Not set</Muted>}</TD>
                  <TD>
                    <StatusBadge active={site.isActive} />
                  </TD>
                  <TD align="right">
                    {/* Its own page, so it opens in a new tab from a list
                        you are working down; the row itself opens the editor. */}
                    <span onClick={(e) => e.stopPropagation()}>
                      <LinkButton
                        href={`/admin/sites/${site.id}`}
                        hierarchy="tertiary"
                        size="sm"
                        trailingIcon={<ChevronRight className="h-3.5 w-3.5" />}
                      >
                        Leave policies
                      </LinkButton>
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </AreaPanel>

      {editing && (
        <SiteDialog site={editing === "new" ? null : editing} pending={isPending} error={error} onSubmit={save} onClose={close} />
      )}
    </>
  );
}

/**
 * What the clock reads in a time zone right now, "11:42 AM", kept current
 * while the window is open. Null for a zone the browser does not know.
 */
function useTimeIn(timeZone: string): string | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  } catch {
    return null;
  }
}

/**
 * Add or edit one site. Also used from the site's own page.
 *
 * <p>One column, in the order someone describes a building: what it is
 * called, where it is, then the time zone its clocks keep, which shows the
 * time there now so a wrong pick is obvious before it stamps a punch.
 */
export function SiteDialog({
  site,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  site: Site | null;
  pending: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  onClose: () => void;
}) {
  const zones = timeZoneOptions(site?.timezone);
  const [zone, setZone] = useState(site?.timezone ?? "America/New_York");
  const timeNow = useTimeIn(zone);
  return (
    <SetupDialog
      title={site ? site.name : "Add site"}
      subtitle={site ? "Edit site" : "A building people clock in at."}
      icon={<Building2 className="h-[18px] w-[18px]" />}
      width={480}
      submitLabel={site ? "Save changes" : "Add site"}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      <Input label="Name" name="name" required defaultValue={site?.name ?? ""} placeholder="Rutherford warehouse" />
      <Input
        label="Address"
        name="address"
        defaultValue={site?.address ?? ""}
        hint="Optional. Helps tell buildings apart on the Sites list."
        placeholder="123 Main St, Rutherford, NJ"
      />
      <SelectField
        label="Time zone"
        name="timezone"
        defaultValue={site?.timezone ?? "America/New_York"}
        onChange={(e) => setZone(e.target.value)}
        hint={`Punches at this site are stamped in this time zone${timeNow ? `, where it's ${timeNow} now.` : "."}`}
      >
        <optgroup label="Common">
          {zones.common.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </optgroup>
        {zones.others.length > 0 && (
          <optgroup label="All time zones">
            {zones.others.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </optgroup>
        )}
      </SelectField>
      {site && (
        <StatusField defaultActive={site.isActive} hint="An inactive site stays on the records that already use it." />
      )}
    </SetupDialog>
  );
}
