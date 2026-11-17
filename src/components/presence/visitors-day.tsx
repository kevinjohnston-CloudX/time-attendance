"use client";

import { useEffect, useState } from "react";
import { IdCard } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { getOnSiteVisitors } from "@/lib/presence/reads";
import type { VisitorDay, VisitorDayRow } from "@/lib/presence/visitor-day.service";
import { VISITOR_KIND_LABEL } from "@/lib/visitors/visitor-pass";
import { fmtTime, initialsOf } from "./presence-meta";
import { Face } from "./face";
import { VisitorTag } from "./visitor-tag";
import type { VisitorList } from "./scan-log";
import styles from "./on-site.module.css";

/**
 * The building's visitors for the Scan log's Visitors panel: the numbers it
 * shows, and the list of people each one opens where the log would be.
 *
 * <p>Who is in the building now comes from the board, not from here, so the
 * panel and the People view always agree (`insideIds`).
 */

const POLL_MS = 60_000;

export function useVisitorDay({ siteId, day, active, pulse }: { siteId: string; day: string; active: boolean; pulse?: string | null }) {
  const key = `${siteId}|${day}`;
  const [state, setState] = useState<{ key: string; data: VisitorDay | null; failed: boolean }>({ key: "", data: null, failed: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !siteId) return;
    let dead = false;
    const load = async () => {
      const r = await getOnSiteVisitors({ siteId, day: day || null }).catch(() => ({ success: false as const }));
      if (dead) return;
      setState((s) => (r.success ? { key, data: r.data, failed: false } : { ...s, key, failed: true }));
    };
    void load();
    // Today keeps asking, and a new scan at the building (the pulse) asks at
    // once; a past day cannot change.
    const t = day ? null : setInterval(() => !document.hidden && void load(), POLL_MS);
    return () => {
      dead = true;
      if (t) clearInterval(t);
    };
  }, [siteId, day, active, key, attempt, pulse]);

  const current = state.key === key ? state : { data: null, failed: false };
  return {
    data: current.data,
    failed: current.failed,
    loading: active && !current.data && !current.failed,
    retry: () => {
      setState((s) => ({ ...s, failed: false }));
      setAttempt((n) => n + 1);
    },
  };
}

/** Whether a visitor belongs in the list a panel number opened. */
export function inVisitorList(r: VisitorDayRow, list: VisitorList, inside: ReadonlySet<string> | null): boolean {
  switch (list) {
    case "visitors-allowed":
      return r.allowed;
    case "visitors-outside":
      return r.allowed && (inside ? !inside.has(r.id) : !r.firstIn);
    case "visitors-came":
      return !!r.firstIn;
    case "visitors-refused":
      return !!r.refusal;
    case "visitors-ending":
      return r.endingSoon;
  }
}

const LIST_TITLE: Record<VisitorList, string> = {
  "visitors-allowed": "Visitors allowed in",
  "visitors-outside": "Visitors not inside",
  "visitors-came": "Visitors who came in",
  "visitors-refused": "Visitors refused at the gate",
  "visitors-ending": "Visitor passes ending this week",
};

function listLine(list: VisitorList, today: boolean): string {
  switch (list) {
    case "visitors-allowed":
      return today ? "A pass for this building that is good today. A pass has no visit date, so not all of them will come" : "A pass for this building that was good that day";
    case "visitors-outside":
      return today ? "Allowed in today and not in the building now: not here yet, or already left" : "Allowed in that day and never came through the gate";
    case "visitors-came":
      return "Came in through the security gate, each counted once";
    case "visitors-refused":
      return "The gate turned their badge away. Renew or end a pass from the visitor's details";
    case "visitors-ending":
      return "Still allowed in, with a last day in the next 7 days";
  }
}

const dayShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function dateWords(d: string, today: string): string {
  return (d.slice(0, 4) === today.slice(0, 4) ? dayShort : dayYear).format(new Date(`${d}T00:00:00.000Z`));
}

const REFUSED: Record<string, string> = {
  VISITOR_EXPIRED: "Pass expired",
  VISITOR_ENDED: "Access ended",
  VISITOR_NOT_YET: "Pass not started",
  VISITOR_OTHER_BUILDING: "Badge for another building",
};

export function VisitorDayView({
  data,
  failed,
  loading,
  list,
  inside,
  tz,
  query,
  selectedId,
  onOpen,
  onRetry,
}: {
  data: VisitorDay | null;
  failed: boolean;
  loading: boolean;
  list: VisitorList;
  /** Today: who is in the building now, from the board. Null on a past day. */
  inside: ReadonlySet<string> | null;
  tz: string;
  query: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  if (failed && !data) {
    return (
      <Card padding={0}>
        <EmptyState
          icon={<IdCard className="h-8 w-8" />}
          title="Visitors could not be loaded"
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
        <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading visitors">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md" style={{ background: "var(--fill-disabled)" }} />
          ))}
        </div>
      </Card>
    );
  }

  const isToday = data.day === data.today;
  const q = query.trim().toLowerCase();
  const all = data.rows.filter((r) => inVisitorList(r, list, isToday ? inside : null));
  const shown = q
    ? all.filter((r) => [r.name, r.badge, r.company ?? "", r.visiting ?? ""].some((v) => v.toLowerCase().includes(q)))
    : all;

  return (
    <Card
      padding={0}
      title={LIST_TITLE[list]}
      subtitle={listLine(list, isToday)}
      actions={
        <Badge tone={list === "visitors-refused" && all.length ? "error" : "neutral"} size="sm">
          {all.length.toLocaleString()}
        </Badge>
      }
    >
      {all.length === 0 ? (
        <EmptyState icon={<IdCard className="h-8 w-8" />} title="No visitors" body={emptyLine(list, isToday)} />
      ) : shown.length === 0 ? (
        <EmptyState icon={<IdCard className="h-8 w-8" />} title="No visitor matches that search" body="Search by name, company, badge or who they are visiting." />
      ) : (
        <ul className={styles.vdList}>
          {shown.map((r) => (
            <VisitorRow
              key={r.id}
              r={r}
              tz={tz}
              today={data.today}
              isToday={isToday}
              inside={isToday && !!inside?.has(r.id)}
              selected={selectedId === r.id}
              onOpen={() => onOpen(r.id)}
            />
          ))}
        </ul>
      )}
      {data.capped && (
        <p className={styles.vdNote}>Only the first 1,000 visitors are listed. Search to find someone further down.</p>
      )}
    </Card>
  );
}

function emptyLine(list: VisitorList, today: boolean): string {
  switch (list) {
    case "visitors-allowed":
      return today ? "No visitor has a pass for this building today. Add one from Visitors." : "No visitor had a pass for this building that day.";
    case "visitors-outside":
      return today ? "Every visitor allowed in today is in the building." : "Every visitor allowed in that day came in.";
    case "visitors-came":
      return today ? "No visitor has come through the gate today." : "No visitor came through the gate that day.";
    case "visitors-refused":
      return "The gate has not turned any visitor away.";
    case "visitors-ending":
      return "No pass for this building ends in the next 7 days.";
  }
}

/**
 * One visitor, read left to right: who they are and who they came to see,
 * their pass, what the gate saw, and where they stand now.
 */
function VisitorRow({
  r,
  tz,
  today,
  isToday,
  inside,
  selected,
  onOpen,
}: {
  r: VisitorDayRow;
  tz: string;
  today: string;
  isToday: boolean;
  inside: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const from = [r.company, r.visiting ? `visiting ${r.visiting}` : null].filter(Boolean).join(" · ");
  const pass = r.pass
    ? {
        main: VISITOR_KIND_LABEL[r.pass.kind],
        sub: !r.allowed
          ? r.pass.standing === "OTHER_BUILDING"
            ? "For another building"
            : r.pass.standing === "ENDED"
              ? "Access ended"
              : r.pass.standing === "NOT_YET"
                ? `Starts ${dateWords(r.pass.validFrom, today)}`
                : `Expired ${dateWords(r.pass.validUntil, today)}`
          : r.pass.validUntil === today
            ? "Ends today"
            : `Until ${dateWords(r.pass.validUntil, today)}`,
      }
    : { main: "No pass", sub: "Badge has no visitor pass" };
  const gate = r.lastScan
    ? r.lastScan.direction === "IN"
      ? { main: `In at ${fmtTime(r.lastScan.at, tz)}`, sub: r.firstIn && r.firstIn !== r.lastScan.at ? `First in at ${fmtTime(r.firstIn, tz)}` : `${r.scans} gate ${r.scans === 1 ? "scan" : "scans"}` }
      : { main: `Left at ${fmtTime(r.lastScan.at, tz)}`, sub: r.firstIn ? `Came in at ${fmtTime(r.firstIn, tz)}` : `${r.scans} gate ${r.scans === 1 ? "scan" : "scans"}` }
    : { main: isToday ? "Not in today" : "Did not come in", sub: "No gate scans" };

  const status = r.refusal
    ? { tone: "error" as const, text: REFUSED[r.refusal.reason] ?? "Refused at the gate" }
    : isToday && inside
      ? { tone: "success" as const, text: "In the building" }
      : r.endingSoon
        ? { tone: "warning" as const, text: r.pass?.validUntil === today ? "Pass ends today" : "Pass ends this week" }
        : { tone: "neutral" as const, text: isToday ? "Not inside" : r.firstIn ? "Came in" : "Did not come in" };

  return (
    <li>
      <button type="button" className={styles.vdRow} aria-pressed={selected} onClick={onOpen} title={`${r.name} · ${r.badge}`}>
        <span className={styles.logPhoto}>
          <span className={styles.initials} aria-hidden="true">
            {initialsOf(r.name)}
          </span>
          <Face src={r.photoUrl} personId={r.id} />
        </span>
        <span className={styles.ubCell}>
          <span className={styles.vdName}>
            <span className="truncate">{r.name}</span>
            <VisitorTag />
          </span>
          <span className={styles.ubSub} title={from || undefined}>
            {from || r.badge}
          </span>
        </span>
        <span className={styles.ubCell}>
          <span className={styles.ubMain}>{pass.main}</span>
          <span className={styles.ubSub}>{pass.sub}</span>
        </span>
        <span className={styles.ubCell}>
          <span className={`${styles.ubMain} tabular`}>{r.refusal ? `Refused at ${fmtTime(r.refusal.at, tz)}` : gate.main}</span>
          <span className={`${styles.ubSub} tabular`}>
            {r.refusal ? (r.refusal.attempts > 1 ? `${r.refusal.attempts} tries` : gate.main) : gate.sub}
          </span>
        </span>
        <span className={styles.ubCost}>
          <Badge tone={status.tone} size="sm">
            {status.text}
          </Badge>
          <span className={`${styles.ubSub} tabular`}>{r.badge}</span>
        </span>
      </button>
    </li>
  );
}

/** The export: the list on screen, one row per visitor, heading first. */
export function visitorDayLines(
  data: VisitorDay,
  site: string,
  keep: (r: VisitorDayRow) => boolean,
  inside: ReadonlySet<string> | null,
): string[][] {
  const tz = data.timezone;
  const header = ["Site", "Day", "Name", "Badge", "Company", "Visiting", "Pass", "Pass until", "In the building", "First in", "Last scan", "Gate scans", "Refused"];
  const lines = data.rows.filter(keep).map((r) => [
    site,
    data.day,
    r.name,
    r.badge,
    r.company ?? "",
    r.visiting ?? "",
    r.pass ? VISITOR_KIND_LABEL[r.pass.kind] : "No pass",
    r.pass?.validUntil ?? "",
    inside ? (inside.has(r.id) ? "Yes" : "No") : "",
    r.firstIn ? fmtTime(r.firstIn, tz) : "",
    r.lastScan ? `${r.lastScan.direction === "IN" ? "In" : "Out"} at ${fmtTime(r.lastScan.at, tz)}` : "",
    String(r.scans),
    r.refusal ? `${REFUSED[r.refusal.reason] ?? "Refused"} at ${fmtTime(r.refusal.at, tz)}` : "",
  ]);
  return [header, ...lines];
}
