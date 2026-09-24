"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Clock, DoorOpen, ScanLine, SearchX } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { getOnSiteScanLog } from "@/actions/presence.actions";
import type { ScanLogPage, ScanLogQuery, ScanLogRow, ScanLogSummary, ScanStream } from "@/lib/presence/types";
import { describeOriginal, describeScan, fmtDuration, fmtTime, initialsOf } from "./presence-meta";
import { iconFor } from "./person-panel";
import styles from "./on-site.module.css";
import { Face } from "./face";
import { SummarySkeleton } from "./movements-view";

/**
 * The scan log: every security gate and time clock scan at the site today,
 * newest first, one row per scan with the face beside it.
 *
 * <p>The board shows each person once, at their latest state. People go in
 * and out through the gate and on and off the clock several times a day, and
 * loss prevention needs every one of those, in order, with the photo that goes
 * with it. That is this view.
 */

const POLL_MS = 30_000;
const SEARCH_DELAY_MS = 300;

/** "unknown" is the badges nobody holds, a list of people rather than of scans. */
export type LogCounter =
  | "gate"
  | "gate-in"
  | "gate-out"
  | "clock"
  | "clock-in"
  | "clock-out"
  | "rejected"
  | "unknown"
  | "first-in"
  | "first-clock"
  | "missed";

export function counterQuery(
  c: LogCounter | null,
): Pick<ScanLogQuery, "stream" | "direction" | "rejected" | "first" | "missed"> {
  if (c === "first-in") return { stream: null, direction: null, rejected: false, first: "gate", missed: false };
  if (c === "first-clock") return { stream: null, direction: null, rejected: false, first: "clock", missed: false };
  if (c === "missed") return { stream: null, direction: null, rejected: false, first: null, missed: true };
  const stream: ScanStream | null = c?.startsWith("gate") ? "SECURITY" : c?.startsWith("clock") ? "TIME_CLOCK" : null;
  const direction = c?.endsWith("-in") ? "IN" : c?.endsWith("-out") ? "OUT" : null;
  return { stream, direction, rejected: c === "rejected", first: null, missed: false };
}

export function parseCounter(raw: string | null | undefined): LogCounter | null {
  const all: LogCounter[] = [
    "gate",
    "gate-in",
    "gate-out",
    "clock",
    "clock-in",
    "clock-out",
    "rejected",
    "unknown",
    "first-in",
    "first-clock",
    "missed",
  ];
  return all.includes(raw as LogCounter) ? (raw as LogCounter) : null;
}

type State = {
  page: ScanLogPage | null;
  rows: ScanLogRow[];
  failure: "access" | "error" | null;
  loadingMore: boolean;
};

/**
 * Loads the log, keeps it live while it is on screen, and pages further back
 * on request.
 *
 * <p>The poll asks only for scans recorded since the last answer and slots
 * them in by scan time, so a scan a tablet posts late from its offline queue
 * lands in its right place rather than at the top.
 */
export function useScanLog({
  siteId,
  active,
  day,
  counter,
  departmentId,
  shiftId,
  q,
}: {
  siteId: string | null;
  active: boolean;
  /** A past day, or "" for today. */
  day: string;
  counter: LogCounter | null;
  departmentId: string;
  shiftId: string;
  q: string;
}) {
  const [state, setState] = useState<State>({ page: null, rows: [], failure: null, loadingMore: false });
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [lastOk, setLastOk] = useState(0);

  // The search waits for typing to pause, so a name is one query, not eight.
  const [needle, setNeedle] = useState(q.trim());
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [q]);

  const query = useMemo<ScanLogQuery>(
    () => ({
      day: day || null,
      ...counterQuery(counter),
      departmentId: departmentId || null,
      shiftId: shiftId || null,
      q: needle || null,
    }),
    [day, counter, departmentId, shiftId, needle],
  );
  const key = `${siteId}|${JSON.stringify(query)}`;

  // Every answer is checked against the question it was for, so a slow reply
  // for filters somebody has already changed is dropped, not drawn.
  const keyRef = useRef(key);
  const pageRef = useRef<ScanLogPage | null>(null);
  const rowsRef = useRef<ScanLogRow[]>([]);
  const inFlight = useRef(false);

  const loadHead = useCallback(async () => {
    if (!siteId) return;
    const forKey = key;
    try {
      const res = await getOnSiteScanLog({ siteId, ...query });
      if (keyRef.current !== forKey) return;
      if (res.success) {
        pageRef.current = res.data;
        rowsRef.current = res.data.rows;
        setState({ page: res.data, rows: res.data.rows, failure: null, loadingMore: false });
        setLastOk(Date.now());
      } else {
        setState((s) => ({ ...s, failure: res.error === "FORBIDDEN" || res.error === "NOT_FOUND" ? "access" : "error" }));
      }
    } catch {
      if (keyRef.current === forKey) setState((s) => ({ ...s, failure: "error" }));
    }
  }, [siteId, key, query]);

  // A new question starts from an empty log, so old rows never sit under new
  // filters looking like an answer.
  useEffect(() => {
    keyRef.current = key;
    if (!active) return;
    pageRef.current = null;
    rowsRef.current = [];
    setState({ page: null, rows: [], failure: null, loadingMore: false });
    void loadHead();
  }, [key, active, loadHead]);

  const poll = useCallback(async () => {
    const page = pageRef.current;
    // A past day is finished; only today's log keeps moving.
    if (!siteId || !page || page.day !== page.today || inFlight.current) return;
    inFlight.current = true;
    const forKey = key;
    try {
      const res = await getOnSiteScanLog({ siteId, ...query, since: page.watermark });
      if (keyRef.current !== forKey || !res.success) return;
      const next = res.data;
      if (next.today !== page.today || next.hasMore) {
        // A new day, or more arrived at once than a poll carries: redraw.
        await loadHead();
        return;
      }
      const known = new Set(rowsRef.current.map((r) => r.id));
      const fresh = next.rows.filter((r) => !known.has(r.id));
      const oldest = rowsRef.current[rowsRef.current.length - 1];
      // A late scan older than everything loaded belongs to a page not yet
      // shown; it will appear there when somebody shows more.
      const fits = fresh.filter((r) => !page.hasMore || !oldest || compareRows(r, oldest) < 0);
      const rows = fits.length ? [...fits, ...rowsRef.current].sort(compareRows) : rowsRef.current;
      const merged: ScanLogPage = { ...page, summary: next.summary, watermark: next.watermark ?? page.watermark };
      pageRef.current = merged;
      rowsRef.current = rows;
      setState((s) => ({ ...s, page: merged, rows, failure: null }));
      setLastOk(Date.now());
      if (fits.length) setChanged(new Set(fits.map((r) => r.id)));
    } catch {
      // The next tick tries again; the live line says when it has been too long.
    } finally {
      inFlight.current = false;
    }
  }, [siteId, key, query, loadHead]);

  useEffect(() => {
    if (!active || !siteId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, siteId, poll]);

  useEffect(() => {
    if (!changed.size) return;
    const t = setTimeout(() => setChanged(new Set()), 2400);
    return () => clearTimeout(t);
  }, [changed]);

  const showMore = useCallback(async () => {
    const page = pageRef.current;
    const last = rowsRef.current[rowsRef.current.length - 1];
    if (!siteId || !page || !last) return;
    const forKey = key;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const res = await getOnSiteScanLog({ siteId, ...query, before: { at: last.at, id: last.id } });
      if (keyRef.current !== forKey) return;
      if (res.success) {
        const known = new Set(rowsRef.current.map((r) => r.id));
        const rows = [...rowsRef.current, ...res.data.rows.filter((r) => !known.has(r.id))];
        const merged: ScanLogPage = { ...page, hasMore: res.data.hasMore };
        pageRef.current = merged;
        rowsRef.current = rows;
        setState((s) => ({ ...s, page: merged, rows, loadingMore: false }));
      } else {
        setState((s) => ({ ...s, loadingMore: false }));
      }
    } catch {
      if (keyRef.current === forKey) setState((s) => ({ ...s, loadingMore: false }));
    }
  }, [siteId, key, query]);

  /** The whole filtered day, for the export, fetched on demand. */
  const fetchAll = useCallback(async () => {
    if (!siteId) return null;
    const res = await getOnSiteScanLog({ siteId, ...query, limit: 5000 });
    return res.success ? res.data : null;
  }, [siteId, query]);

  return {
    ...state,
    changed,
    lastOk,
    searching: !!needle,
    retry: loadHead,
    showMore,
    fetchAll,
  };
}

function compareRows(a: ScanLogRow, b: ScanLogRow): number {
  return b.at.localeCompare(a.at) || b.id.localeCompare(a.id);
}

/* ── Counts ─────────────────────────────────────────────────────────────── */

/**
 * The Scan log's summary as its two sources of truth, side by side: one
 * panel per reader, read the same way in both. Who is there now, then the
 * people it saw (each counted once), then its scans in and out, then what
 * went wrong at it. Every number is the filter for it, and the lead number
 * opens those people in Movements.
 */
export function ScanLogCounts({
  summary,
  counter,
  onPick,
  hasGateData,
  lastGateScanAt,
  tz,
  when,
  unknownCount = 0,
  stillInside,
  onStillInside,
  clockNow,
  onClockNow,
}: {
  summary: ScanLogSummary;
  counter: LogCounter | null;
  onPick: (c: LogCounter | null) => void;
  /** Badges scanned here that nobody in CloudTime holds. */
  unknownCount?: number;
  hasGateData: boolean;
  lastGateScanAt: string | null;
  tz: string;
  /** "today", "yesterday" or "on Mon, Sep 21". */
  when: string;
  /** Today: how many are in the building now. */
  stillInside: number | null;
  /** Opens them in Movements (or, on a past day, those who never scanned out). */
  onStillInside: () => void;
  /** Today: how many are on the clock now. */
  clockNow: number | null;
  onClockNow: () => void;
}) {
  const isToday = when === "today";
  const pick = (c: LogCounter) => onPick(counter === c ? null : c);

  const gate: ReaderPanelProps = {
    icon: <DoorOpen className="h-4 w-4" aria-hidden="true" />,
    title: "Security gate",
    total: { key: "gate", count: summary.gateTotal },
    lead: isToday
      ? { label: "In the building", figure: stillInside ?? 0, sub: `of ${summary.peopleIn.toLocaleString()} who came in today` }
      : { label: "Never scanned out", figure: summary.gateAutoClosed, sub: `of ${summary.peopleIn.toLocaleString()} who came in` },
    onLead: onStillInside,
    stats: [
      { key: "first-in", label: "Came in", count: summary.peopleIn, unit: "people", hint: "People who came in through the gate, each counted once. Shows each person's first entry" },
      { key: "gate-in", label: "In", count: summary.gateIn, unit: "scans" },
      { key: "gate-out", label: "Out", count: summary.gateOut, unit: "scans" },
    ],
    exceptions: [
      {
        key: "missed",
        label: "Missed gate scans",
        count: summary.missedGate,
        tone: "warning",
        hint: "An entry with no exit before the next entry, or an exit with no entry before the next exit. This is why gate ins minus outs can differ from who is in the building",
      },
    ],
    note: isToday && lastGateScanAt ? `Last scan at ${fmtTime(lastGateScanAt, tz)}` : null,
    quiet: "No missed scans",
  };

  const clock: ReaderPanelProps = {
    icon: <Clock className="h-4 w-4" aria-hidden="true" />,
    title: "Time clock",
    total: { key: "clock", count: summary.clockTotal },
    lead: isToday
      ? { label: "On the clock", figure: clockNow ?? 0, sub: `of ${summary.peopleClockedIn.toLocaleString()} who clocked in today` }
      : { label: "Never clocked out", figure: summary.clockAutoClosed, sub: `of ${summary.peopleClockedIn.toLocaleString()} who clocked in` },
    onLead: isToday ? onClockNow : onStillInside,
    stats: [
      { key: "first-clock", label: "Clocked in", count: summary.peopleClockedIn, unit: "people", hint: "People who clocked in, each counted once. Shows each person's first clock in" },
      { key: "clock-in", label: "In", count: summary.clockIn, unit: "scans" },
      { key: "clock-out", label: "Out", count: summary.clockOut, unit: "scans" },
    ],
    exceptions: [
      {
        key: "rejected",
        label: "Taps not counted",
        count: summary.rejected,
        tone: "error",
        hint: "Taps the time clock did not accept, usually a second tap too soon, and repeat reads of the same badge. They are left out of every other list and total",
      },
      {
        key: "unknown",
        label: "Not in CloudTime",
        count: unknownCount,
        tone: "warning",
        hint: "People who scanned here on a badge no employee holds. Their time clock scans were refused",
      },
    ],
    note: null,
    quiet: "Every tap was counted",
  };

  return (
    <section className={styles.rpGrid} aria-label="Scans">
      {hasGateData ? (
        <ReaderPanel {...gate} counter={counter} pick={pick} />
      ) : (
        <div className={styles.rpPanel} data-off="true">
          <div className={styles.rpHead}>
            <span className={styles.rpMark} aria-hidden="true">
              <DoorOpen className="h-4 w-4" />
            </span>
            <span className={styles.rpTitle}>Security gate</span>
          </div>
          <div className={styles.rpOff}>
            <span className={styles.rpOffTitle}>Not reporting</span>
            <span className={styles.rpOffText}>
              The security gate here has not reported in the last 36 hours, so people are counted from the time clock.
            </span>
          </div>
        </div>
      )}
      <ReaderPanel {...clock} counter={counter} pick={pick} />
    </section>
  );
}

interface ReaderPanelProps {
  icon: ReactNode;
  title: string;
  total: { key: LogCounter; count: number };
  lead: { label: string; figure: number; sub: string };
  onLead: () => void;
  stats: { key: LogCounter; label: string; count: number; unit: string; hint?: string }[];
  exceptions: { key: LogCounter; label: string; count: number; tone: "warning" | "error"; hint: string }[];
  note: string | null;
  /** Said when nothing went wrong, so the panel reads as checked, not empty. */
  quiet: string;
}

function ReaderPanel({
  icon,
  title,
  total,
  lead,
  onLead,
  stats,
  exceptions,
  note,
  quiet,
  counter,
  pick,
}: ReaderPanelProps & { counter: LogCounter | null; pick: (c: LogCounter) => void }) {
  const shown = exceptions.filter((e) => e.count > 0 || counter === e.key);
  return (
    <div className={styles.rpPanel}>
      <div className={styles.rpHead}>
        <span className={styles.rpMark} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.rpTitle}>{title}</span>
        <button
          type="button"
          className={styles.rpTotal}
          aria-pressed={counter === total.key}
          onClick={() => pick(total.key)}
          title={`Show every ${title.toLowerCase()} scan`}
        >
          <span className="tabular">{total.count.toLocaleString()}</span> {total.count === 1 ? "scan" : "scans"}
        </button>
      </div>

      <div className={styles.rpBody}>
        <button type="button" className={styles.rpLead} onClick={onLead} title="Show these people in Movements">
          <span className={styles.rpLeadLabel}>
            {lead.label}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className={styles.rpLeadFigure}>{lead.figure.toLocaleString()}</span>
          <span className={styles.rpSub}>{lead.sub}</span>
        </button>
        <div className={styles.rpStats}>
          {stats.map((s) => (
            <button
              key={s.key}
              type="button"
              className={styles.rpStat}
              aria-pressed={counter === s.key}
              data-empty={s.count === 0 ? "true" : undefined}
              onClick={() => pick(s.key)}
              title={s.hint}
            >
              <span className={styles.rpStatLabel}>{s.label}</span>
              <span className={styles.rpStatFigure}>{s.count.toLocaleString()}</span>
              <span className={styles.rpSub}>{s.unit}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.rpFoot}>
        {shown.length > 0 ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {shown.map((e) => (
              <button
                key={e.key}
                type="button"
                className={styles.summaryChip}
                aria-pressed={counter === e.key}
                onClick={() => pick(e.key)}
                title={e.hint}
              >
                <span className={styles.dot} data-tone={e.tone} aria-hidden="true" />
                <span>{e.label}</span>
                <span className={styles.summaryChipCount}>{e.count.toLocaleString()}</span>
              </button>
            ))}
          </span>
        ) : (
          <span className={styles.rpQuiet}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {quiet}
          </span>
        )}
        {note && <span className={styles.rpNote}>{note}</span>}
      </div>
    </div>
  );
}

/* ── The log ────────────────────────────────────────────────────────────── */

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2 PM", in the site's zone. */
function hourOf(iso: string, timeZone: string): string {
  let f = hourFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: true });
    hourFormatters.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

/**
 * One panel, the day read top to bottom, with a heading per hour that pins
 * under the top bar so a long afternoon never loses its place.
 */
export function ScanLogList({
  rows,
  tz,
  stickyTop,
  changed,
  selectedId,
  onOpen,
  hasMore,
  loadingMore,
  onShowMore,
}: {
  rows: ScanLogRow[];
  tz: string;
  stickyTop: number;
  changed: Set<string>;
  selectedId: string | null;
  onOpen: (employeeId: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onShowMore: () => void;
}) {
  const hours = useMemo(() => {
    const out: { hour: string; rows: ScanLogRow[] }[] = [];
    for (const r of rows) {
      const h = hourOf(r.at, tz);
      const last = out[out.length - 1];
      if (last && last.hour === h) last.rows.push(r);
      else out.push({ hour: h, rows: [r] });
    }
    return out;
  }, [rows, tz]);

  return (
    <section className={styles.group} aria-label="Scan log">
      {hours.map((h) => (
        <div key={h.hour} role="group" aria-label={h.hour}>
          <h2 className={`${styles.groupHead} ${styles.logHour}`} style={{ top: stickyTop }}>
            <span className={styles.groupTitle}>{h.hour}</span>
            <span className={styles.groupCount}>{h.rows.length.toLocaleString()}</span>
          </h2>
          <ol className={styles.log}>
            {h.rows.map((r) => (
              <LogRow
                key={r.id}
                row={r}
                tz={tz}
                changed={changed.has(r.id)}
                selected={r.person.id === selectedId}
                onOpen={() => onOpen(r.person.id)}
              />
            ))}
          </ol>
        </div>
      ))}
      <div className={styles.logFoot}>
        <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
          {hasMore
            ? `Showing the latest ${rows.length.toLocaleString()} scans`
            : `${rows.length.toLocaleString()} ${rows.length === 1 ? "scan" : "scans"}, the whole day`}
        </span>
        {hasMore && (
          <Button hierarchy="secondary" size="sm" onClick={onShowMore} disabled={loadingMore}>
            {loadingMore ? "Loading" : "Show earlier scans"}
          </Button>
        )}
      </div>
    </section>
  );
}

function LogRow({
  row: r,
  tz,
  changed,
  selected,
  onOpen,
}: {
  row: ScanLogRow;
  tz: string;
  changed: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const { icon, kind } = iconFor(r);
  const photo = r.photoUrl ?? r.person.photoUrl;
  const gate = r.stream === "SECURITY";
  return (
    <li>
      <button
        type="button"
        className={styles.logRow}
        aria-pressed={selected}
        data-changed={changed ? "true" : undefined}
        onClick={onOpen}
        title={`${r.person.name} · ${r.person.employeeCode}`}
      >
        <span className={styles.logTime}>{fmtTime(r.at, tz)}</span>

        <span className={styles.logPhoto}>
          <span className={styles.initials} aria-hidden="true">
            {initialsOf(r.person.name)}
          </span>
          <Face src={photo} />
        </span>

        <span className={styles.logWho}>
          <span className={styles.name}>{r.person.name}</span>
          <span className={styles.meta}>
            {r.person.employeeCode}
            {(r.person.jobTitle ?? r.person.department) ? ` · ${r.person.jobTitle ?? r.person.department}` : ""}
            {r.person.homeSite ? ` · From ${r.person.homeSite}` : ""}
          </span>
        </span>

        <span className={styles.logWhat}>
          <span className={styles.eventIcon} data-kind={r.rejected ? "error" : kind} aria-hidden="true">
            {icon}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate" style={{ font: "var(--weight-medium) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
              {describeScan(r)}
            </span>
            <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
              {[gate ? "Security gate" : "Time clock", r.rejected && r.rejectionReason ? r.rejectionReason : r.device]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </span>

        <span className={styles.logContext} data-tone={r.context?.long ? "warning" : undefined}>
          {contextText(r.context, tz)}
        </span>

        {/* Only what is out of the ordinary gets a tag; the reader is named
            under the event, and its icon leads it. */}
        <span className={styles.logTags}>
          {r.rejected && (
            <Badge tone="error" size="sm">
              Not accepted
            </Badge>
          )}
          {r.automatic && (
            <Badge tone="neutral" size="sm">
              Added by the system
            </Badge>
          )}
          {r.correctedFrom && (
            <span title={`Recorded at the tap as "${describeOriginal(r)}", corrected in the timecard`}>
              <Badge tone="info" size="sm">
                Corrected, was {describeOriginal(r)?.toLowerCase()}
              </Badge>
            </span>
          )}
          {r.reread && (
            <Badge tone="neutral" size="sm">
              Read twice
            </Badge>
          )}
        </span>
      </button>
    </li>
  );
}

/** A scan next to the one before it, in words: "After 12 hr 4 min inside". */
function contextText(c: ScanLogRow["context"], tz: string): string {
  if (!c) return "";
  const since = c.since ? fmtTime(c.since, tz) : "";
  const d = c.minutes === null ? "" : c.minutes < 1 ? "less than a minute" : fmtDuration(c.minutes);
  switch (c.kind) {
    case "inside":
      return `After ${d} inside`;
    case "out":
      return `Back after ${d} out`;
    case "firstIn":
      return "First entry today";
    case "worked":
      return `Worked ${d}`;
    case "working":
      return `After ${d} working`;
    case "meal":
      return `Meal of ${d}`;
    case "break":
      return `Break of ${d}`;
    case "off":
      return `Back after ${d} off the clock`;
    case "firstClock":
      return "First clock in today";
    case "reentry":
      return `Came in again, no exit since ${since}`;
    case "reexit":
      return `Left again, no entry since ${since}`;
  }
}

/* ── States ─────────────────────────────────────────────────────────────── */

export function ScanLogEmpty({
  counter,
  searching,
  filtered,
  hasGateData,
  onClear,
  when,
}: {
  counter: LogCounter | null;
  searching: boolean;
  filtered: boolean;
  hasGateData: boolean;
  onClear: () => void;
  when: string;
}) {
  if (searching || filtered || counter) {
    return (
      <EmptyState
        icon={<SearchX className="h-8 w-8" />}
        title="No matching scans"
        body={
          counter?.startsWith("gate") && !hasGateData
            ? "The security gate at this site has not reported, so there are no gate scans to show."
            : `No scan ${when} matches what you have picked. Clear the filters to see the whole log.`
        }
        action={
          <Button hierarchy="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={<ScanLine className="h-8 w-8" />}
      title={when === "today" ? "No scans yet today" : `No scans ${when}`}
      body={
        when === "today"
          ? "Every security gate and time clock scan at this site will appear here as it happens."
          : "Neither reader at this site recorded a scan that day."
      }
    />
  );
}

export function ScanLogSkeleton() {
  const bar = (w: string | number, h: number, r?: number) => (
    <span className={styles.skeleton} style={{ width: w, height: h, borderRadius: r }} />
  );
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the scan log">
      <SummarySkeleton cards={4} />
      <div className={styles.group}>
        <div className={styles.groupHead} style={{ padding: "14px 16px" }}>
          {bar(80, 18)}
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            {bar(64, 14)}
            {bar(44, 44, 10)}
            {bar("22%", 14)}
            {bar("30%", 14)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Export ─────────────────────────────────────────────────────────────── */

export function scanLogCsv(rows: ScanLogRow[], tz: string, cell: (v: string) => string, site: string): string {
  const header = ["Time", "Name", "Employee code", "Department", "Home site", "Reader", "Scan", "Device", "Accepted", "Notes"];
  const lines = [
    header,
    ...rows.map((r) => [
      fmtTime(r.at, tz),
      r.person.name,
      r.person.employeeCode,
      r.person.department ?? "",
      r.person.homeSite ?? site,
      r.stream === "SECURITY" ? "Security gate" : "Time clock",
      describeScan(r),
      r.device ?? "",
      r.stream === "SECURITY" ? "" : r.rejected ? "No" : "Yes",
      [
        r.rejected ? r.rejectionReason : null,
        r.automatic ? "Added by the system" : null,
        r.correctedFrom ? `Corrected in the timecard, recorded as ${describeOriginal(r)}` : null,
        r.reread ? "Read twice" : null,
      ]
        .filter(Boolean)
        .join(". "),
    ]),
  ];
  return lines.map((l) => l.map(cell).join(",")).join("\r\n");
}
