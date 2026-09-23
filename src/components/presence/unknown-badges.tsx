"use client";

import { useEffect, useState } from "react";
import { BadgeHelp } from "lucide-react";
import { Badge, Button, Card, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getOnSiteUnknownBadges } from "@/actions/unknown-badges.actions";
import type { UnknownBadge, UnknownBadgeDay } from "@/lib/presence/unknown-badges.service";
import { fmtTime } from "./presence-meta";

/**
 * Badges scanned here that match nobody in CloudTime, for loss prevention.
 *
 * <p>Reached from the "Not in CloudTime" chip in the scan log's totals. The
 * people it lists walked the building on a badge CloudTime has no record
 * for, so every time clock scan they made was refused and none of it is on a
 * timecard. The list is what someone photographs or exports and sends to HR.
 *
 * <p>Two groups. First, badges nobody holds. Then badges somebody was given
 * later the same day: that person is in CloudTime now, but the scans before
 * it still match nobody and their punches from then were never recorded,
 * which is the part payroll still has to put right.
 */

const POLL_MS = 60_000;

export function useUnknownBadges({ siteId, day, active }: { siteId: string; day: string; active: boolean }) {
  const key = `${siteId}|${day}`;
  const [state, setState] = useState<{ key: string; data: UnknownBadgeDay | null; failed: boolean }>({
    key: "",
    data: null,
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !siteId) return;
    let dead = false;
    const load = async () => {
      const r = await getOnSiteUnknownBadges({ siteId, day: day || null });
      if (dead) return;
      setState((s) => (r.success ? { key, data: r.data, failed: false } : { ...s, key, failed: true }));
    };
    void load();
    // A past day cannot change, so only today keeps asking.
    const t = day ? null : setInterval(() => void load(), POLL_MS);
    return () => {
      dead = true;
      if (t) clearInterval(t);
    };
  }, [siteId, day, active, key, attempt]);

  // Another site or day is on its way: show nothing rather than the last one.
  const current = state.key === key ? state : { data: null, failed: false };
  const notHeld = current.data?.badges.filter((b) => !b.addedAs) ?? [];
  return {
    data: current.data,
    failed: current.failed,
    loading: active && !current.data && !current.failed,
    /** Badges nobody holds: what the chip counts. */
    count: notHeld.length,
    retry: () => {
      setState((s) => ({ ...s, failed: false }));
      setAttempt((n) => n + 1);
    },
  };
}

function matches(b: UnknownBadge, q: string): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  return (
    b.badgeCode.includes(n) ||
    (b.wmsName ?? "").toLowerCase().includes(n) ||
    (b.addedAs?.name ?? "").toLowerCase().includes(n)
  );
}

export function UnknownBadgesView({
  data,
  failed,
  loading,
  tz,
  when,
  query,
  peopleFiltered,
  onRetry,
}: {
  data: UnknownBadgeDay | null;
  failed: boolean;
  loading: boolean;
  tz: string;
  when: string;
  query: string;
  /** A department or shift is picked. Neither applies to a badge with no record. */
  peopleFiltered: boolean;
  onRetry: () => void;
}) {
  if (failed && !data) {
    return (
      <Card padding={0}>
        <EmptyState
          icon={<BadgeHelp className="h-8 w-8" />}
          title="Badges not in CloudTime could not be loaded"
          body="Something went wrong reading them. Try again, and if it keeps happening, reload the page."
          action={
            <Button hierarchy="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card padding={0}>
        <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading badges not in CloudTime">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md" style={{ background: "var(--fill-disabled)" }} />
          ))}
        </div>
      </Card>
    );
  }
  if (!data.placeable) {
    return (
      <Card padding={0}>
        <EmptyState
          icon={<BadgeHelp className="h-8 w-8" />}
          title="Badges cannot be placed at this site"
          body="This site has no warehouse number in Company Setup, so a badge nobody holds cannot be tied to it. Add the number the readers post and they will show here."
        />
      </Card>
    );
  }

  const shown = data.badges.filter((b) => matches(b, query.trim()));
  const notHeld = shown.filter((b) => !b.addedAs);
  const addedLater = shown.filter((b) => b.addedAs);

  if (data.badges.length === 0) {
    return (
      <Card padding={0}>
        <EmptyState
          icon={<BadgeHelp className="h-8 w-8" />}
          title={when === "today" ? "Every badge matched someone today" : `Every badge matched someone ${when}`}
          body="Anyone who scans here on a badge CloudTime has no record for will be listed, so HR can add them."
        />
      </Card>
    );
  }
  if (shown.length === 0) {
    return (
      <Card padding={0}>
        <EmptyState
          icon={<BadgeHelp className="h-8 w-8" />}
          title="No badge matches that search"
          body="Search by the name the WMS has for someone, or by badge number."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {peopleFiltered && (
        <p style={{ margin: 0, font: "var(--type-body2)", color: "var(--text-secondary)" }}>
          Department and shift do not narrow this list, because these badges have no record to take them from.
        </p>
      )}

      <Card
        padding={0}
        title="Not in CloudTime"
        subtitle={
          notHeld.length === 0
            ? "Everyone listed below has since been added"
            : "Scanned here on a badge no employee holds. Their time clock scans were refused, so none of it is on a timecard"
        }
        actions={<CountPill n={notHeld.length} tone={notHeld.length ? "warning" : "neutral"} />}
      >
        {notHeld.length > 0 && <BadgeTable rows={notHeld} tz={tz} />}
      </Card>

      {addedLater.length > 0 && (
        <Card
          padding={0}
          title={when === "today" ? "Added later today" : "Added later"}
          subtitle="In CloudTime now, but their punches from before they were added were not recorded"
          actions={<CountPill n={addedLater.length} tone="neutral" />}
        >
          <BadgeTable rows={addedLater} tz={tz} added />
        </Card>
      )}
    </div>
  );
}

function CountPill({ n, tone }: { n: number; tone: "warning" | "neutral" }) {
  return (
    <Badge tone={tone} size="sm">
      {n.toLocaleString()}
    </Badge>
  );
}

function BadgeTable({ rows, tz, added = false }: { rows: UnknownBadge[]; tz: string; added?: boolean }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>{added ? "Now in CloudTime as" : "Name in the WMS"}</TH>
          <TH>Badge</TH>
          <TH>Department</TH>
          <TH>First seen</TH>
          <TH>Last seen</TH>
          <TH>Last reader</TH>
          <TH numeric>Gate scans</TH>
          <TH numeric>Refused punches</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((b) => (
          <TR key={b.badgeCode}>
            <TD>
              <span
                className="block max-w-[220px] truncate"
                style={{
                  font: "var(--weight-medium) 14px/20px var(--font-sans)",
                  color: added || b.wmsName ? "var(--text-primary)" : "var(--text-tertiary)",
                }}
                title={added ? b.addedAs?.name : b.wmsName ?? undefined}
              >
                {added ? b.addedAs?.name : b.wmsName ?? "Name unknown"}
              </span>
            </TD>
            <TD>
              <span className="tabular whitespace-nowrap">{b.badgeCode}</span>
            </TD>
            <TD>
              <span className="block max-w-[180px] truncate" title={b.wmsDepartment ?? undefined}>
                {b.wmsDepartment ?? ""}
              </span>
            </TD>
            <TD>
              <span className="tabular whitespace-nowrap">{fmtTime(b.firstSeen, tz)}</span>
            </TD>
            <TD>
              <span className="tabular whitespace-nowrap">{fmtTime(b.lastSeen, tz)}</span>
            </TD>
            <TD>
              <span className="block max-w-[180px] truncate" title={b.lastReader ?? undefined}>
                {b.lastReader ?? ""}
              </span>
            </TD>
            <TD numeric>{b.gateScans.toLocaleString()}</TD>
            <TD numeric>
              {b.refusedPunches > 0 ? (
                <Badge tone={added ? "neutral" : "error"} size="sm">
                  {b.refusedPunches.toLocaleString()}
                </Badge>
              ) : (
                "0"
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** The export: both groups, in the order on screen, one row per badge. */
export function unknownBadgesCsv(data: UnknownBadgeDay, cell: (v: string) => string, site: string): string {
  const tz = data.timezone;
  const header = [
    "Site", "Day", "Status", "Name in the WMS", "Now in CloudTime as", "Badge", "Department",
    "First seen", "Last seen", "Last reader", "Gate scans", "Refused punches",
  ];
  const ordered = [...data.badges.filter((b) => !b.addedAs), ...data.badges.filter((b) => b.addedAs)];
  const lines = ordered.map((b) => [
    site,
    data.day,
    b.addedAs ? "Added later" : "Not in CloudTime",
    b.wmsName ?? "",
    b.addedAs?.name ?? "",
    b.badgeCode,
    b.wmsDepartment ?? "",
    fmtTime(b.firstSeen, tz),
    fmtTime(b.lastSeen, tz),
    b.lastReader ?? "",
    String(b.gateScans),
    String(b.refusedPunches),
  ]);
  return [header, ...lines].map((r) => r.map(cell).join(",")).join("\r\n");
}
