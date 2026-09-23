"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, DoorOpen, ScanLine, SearchX } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { getOnSiteScanLog } from "@/actions/presence.actions";
import type { ScanLogPage, ScanLogQuery, ScanLogRow, ScanLogSummary, ScanStream } from "@/lib/presence/types";
import { describeScan, fmtTime, initialsOf } from "./presence-meta";
import { iconFor } from "./person-panel";
import styles from "./on-site.module.css";
import { Face } from "./face";

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

export type LogCounter = "gate" | "gate-in" | "gate-out" | "clock" | "clock-in" | "clock-out" | "rejected";

export function counterQuery(c: LogCounter | null): Pick<ScanLogQuery, "stream" | "direction" | "rejected"> {
  const stream: ScanStream | null = c?.startsWith("gate") ? "SECURITY" : c?.startsWith("clock") ? "TIME_CLOCK" : null;
  const direction = c?.endsWith("-in") ? "IN" : c?.endsWith("-out") ? "OUT" : null;
  return { stream, direction, rejected: c === "rejected" };
}

export function parseCounter(raw: string | null | undefined): LogCounter | null {
  const all: LogCounter[] = ["gate", "gate-in", "gate-out", "clock", "clock-in", "clock-out", "rejected"];
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
 * The two readers side by side, drawn exactly like the board's headcount: a
 * big number, and counters under it that are also the filters.
 */
export function ScanLogCounts({
  summary,
  counter,
  onPick,
  hasGateData,
  lastGateScanAt,
  tz,
  when,
}: {
  summary: ScanLogSummary;
  counter: LogCounter | null;
  onPick: (c: LogCounter | null) => void;
  hasGateData: boolean;
  lastGateScanAt: string | null;
  tz: string;
  /** "today", "yesterday" or "on Mon, Sep 21". */
  when: string;
}) {
  const isToday = when === "today";
  const pick = (c: LogCounter) => onPick(counter === c ? null : c);
  return (
    <section className={`${styles.headcount} ${styles.headcountEven}`} aria-label="Scans today">
      <div className={styles.side}>
        <ReaderTotal
          icon={<DoorOpen className="h-5 w-5" />}
          figure={summary.gateTotal}
          label={`${summary.gateTotal === 1 ? "security gate scan" : "security gate scans"} ${when}`}
          active={counter === "gate"}
          onClick={() => pick("gate")}
        />
        <div className={styles.counters}>
          <LogCount label="In" tone="in" count={summary.gateIn} active={counter === "gate-in"} onClick={() => pick("gate-in")} />
          <LogCount label="Out" tone="out" count={summary.gateOut} active={counter === "gate-out"} onClick={() => pick("gate-out")} />
        </div>
        <p className={styles.footnote}>
          {!hasGateData
            ? "The security gate here has not reported in the last 36 hours."
            : isToday
              ? `Last security gate scan at ${fmtTime(lastGateScanAt, tz)}.`
              : summary.gateTotal === 0
                ? `No security gate scans ${when}.`
                : summary.gateAutoClosed === 0
                  ? "Nobody had to be marked out overnight by the system."
                  : `${summary.gateAutoClosed.toLocaleString()} ${
                      summary.gateAutoClosed === 1 ? "person was" : "people were"
                    } marked out overnight with no exit scan.`}
        </p>
      </div>

      <div className={styles.side}>
        <ReaderTotal
          icon={<Clock className="h-5 w-5" />}
          figure={summary.clockTotal}
          label={`${summary.clockTotal === 1 ? "time clock scan" : "time clock scans"} ${when}`}
          active={counter === "clock"}
          onClick={() => pick("clock")}
        />
        <div className={styles.counters}>
          <LogCount label="In" tone="in" count={summary.clockIn} active={counter === "clock-in"} onClick={() => pick("clock-in")} />
          <LogCount label="Out" tone="out" count={summary.clockOut} active={counter === "clock-out"} onClick={() => pick("clock-out")} />
          <LogCount
            label="Not accepted"
            tone="error"
            count={summary.rejected}
            active={counter === "rejected"}
            onClick={() => pick("rejected")}
            hint="Time clock scans the timecard refused"
          />
        </div>
        <p className={styles.footnote}>
          {summary.people === 0
            ? `Nobody scanned at either reader ${when}.`
            : `${summary.people.toLocaleString()} ${summary.people === 1 ? "person" : "people"} scanned at either reader ${when}.`}
        </p>
      </div>
    </section>
  );
}

function ReaderTotal({
  icon,
  figure,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  figure: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.total} aria-pressed={active} data-active={active ? "true" : undefined} onClick={onClick}>
      <span className={styles.readerIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.totalFigure}>{figure.toLocaleString()}</span>
      <span className={styles.totalLabel}>{label}</span>
    </button>
  );
}

function LogCount({
  label,
  tone,
  count,
  active,
  onClick,
  hint,
}: {
  label: string;
  tone: "in" | "out" | "error";
  count: number;
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      className={styles.counter}
      aria-pressed={active}
      data-empty={count === 0 ? "true" : undefined}
      onClick={onClick}
      title={hint}
    >
      <span className={styles.counterFigure}>{count.toLocaleString()}</span>
      <span className={styles.counterLabel}>
        <span className={styles.dot} data-tone={tone} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    </button>
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
            {r.person.department ? ` · ${r.person.department}` : ""}
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
              {r.rejected && r.rejectionReason ? r.rejectionReason : r.device ?? ""}
            </span>
          </span>
        </span>

        <span className={styles.logTags}>
          <span className={styles.source} data-stream={gate ? "gate" : "clock"}>
            {gate ? <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
            {gate ? "Security gate" : "Time clock"}
          </span>
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
      <div className={`${styles.headcount} ${styles.headcountEven}`}>
        {[0, 1].map((i) => (
          <div key={i} className={styles.side}>
            {bar(240, 44)}
            <div className={styles.counters}>
              {Array.from({ length: i ? 3 : 2 }, (_, j) => (
                <span key={j}>{bar("100%", 58)}</span>
              ))}
            </div>
            {bar("60%", 12)}
          </div>
        ))}
      </div>
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

export function scanLogCsv(rows: ScanLogRow[], tz: string, cell: (v: string) => string): string {
  const header = ["Time", "Name", "Employee code", "Department", "Reader", "Scan", "Device", "Accepted", "Notes"];
  const lines = [
    header,
    ...rows.map((r) => [
      fmtTime(r.at, tz),
      r.person.name,
      r.person.employeeCode,
      r.person.department ?? "",
      r.stream === "SECURITY" ? "Security gate" : "Time clock",
      describeScan(r),
      r.device ?? "",
      r.stream === "SECURITY" ? "" : r.rejected ? "No" : "Yes",
      [r.rejected ? r.rejectionReason : null, r.automatic ? "Added by the system" : null, r.reread ? "Read twice" : null]
        .filter(Boolean)
        .join(". "),
    ]),
  ];
  return lines.map((l) => l.map(cell).join(",")).join("\r\n");
}
