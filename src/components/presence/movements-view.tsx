"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock, DoorOpen, UserRoundX } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { getOnSiteMovements } from "@/actions/presence.actions";
import type { PresenceStatus, SiteDay } from "@/lib/presence/types";
import {
  LONG_BREAK_MIN,
  type MovementFlag,
  type MovementLine,
  type PersonDayView,
  type ScanTotals,
} from "@/lib/presence/movements";
import type { LogCounter } from "./scan-log";
import { STATUS_META, describeScan, fmtDuration, fmtShift, fmtTime, initialsOf } from "./presence-meta";
import { iconFor } from "./person-panel";
import styles from "./on-site.module.css";
import { ZoomableFace } from "./face";
import { HomeSiteBadge } from "./home-site";

/**
 * Movements: one block per person, their photo and name on the left, and on
 * the right one line for every stretch the readers saw that day. Built for
 * loss prevention reading one person's day at a glance: every trip in and out
 * through the gate, every stretch on the clock, every meal, in order.
 */

const POLL_MS = 30_000;
export const PEOPLE_PER_PAGE = 50;

/**
 * Loads one site's day and keeps it current while it is on screen. The poll
 * sends what it already has; the server answers "unchanged" unless a new
 * scan was recorded, so most refreshes cost one small query.
 */
export function useSiteDay({ siteId, active, day }: { siteId: string | null; active: boolean; day: string }) {
  const [data, setData] = useState<SiteDay | null>(null);
  const [failure, setFailure] = useState<"access" | "error" | null>(null);
  const key = `${siteId}|${day}`;
  const keyRef = useRef(key);
  const dataRef = useRef<SiteDay | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(
    async (poll: boolean) => {
      if (!siteId || inFlight.current) return;
      const forKey = key;
      const have = dataRef.current;
      inFlight.current = true;
      try {
        const res = await getOnSiteMovements({
          siteId,
          day: day || null,
          since: poll && have ? { watermark: have.watermark, generatedAt: have.generatedAt } : null,
        });
        if (keyRef.current !== forKey) return;
        if (!res.success) {
          setFailure(res.error === "FORBIDDEN" || res.error === "NOT_FOUND" ? "access" : "error");
          return;
        }
        setFailure(null);
        if ("unchanged" in res.data) return;
        dataRef.current = res.data;
        setData(res.data);
      } catch {
        if (keyRef.current === forKey) setFailure("error");
      } finally {
        inFlight.current = false;
      }
    },
    [siteId, day, key],
  );

  useEffect(() => {
    keyRef.current = key;
    if (!active) return;
    dataRef.current = null;
    inFlight.current = false;
    setData(null);
    setFailure(null);
    void load(false);
  }, [key, active, load]);

  useEffect(() => {
    if (!active || !siteId) return;
    const tick = () => {
      const d = dataRef.current;
      // A finished day does not change; only today is polled.
      if (document.visibilityState === "visible" && (!d || d.day === d.today)) void load(true);
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, siteId, load]);

  return { data: data && data.site.id === siteId ? data : null, failure, retry: () => load(false) };
}

/** What a person is doing at the end of the recorded day, in the board's own words. */
export function statusOfDay(v: PersonDayView, isToday: boolean, hasGate: boolean): PresenceStatus | null {
  if (!isToday) return null;
  const { inside, clock } = v.now;
  if (clock === "WORK") return hasGate && !inside ? "NO_GATE_SCAN" : "WORKING";
  if (clock === "MEAL" || clock === "BREAK") return "ON_MEAL";
  if (inside) return "OFF_CLOCK";
  if (v.scanCount > 0) return "LEFT";
  if (v.person.onLeave) return "ON_LEAVE";
  if (v.schedule) return "NOT_ARRIVED";
  return null;
}

/** The short chips under a name: only what is worth a look. */
function flagChips(v: PersonDayView, isToday: boolean): { label: string; tone: "warning" | "error" | "neutral" | "info" }[] {
  const out: { label: string; tone: "warning" | "error" | "neutral" | "info" }[] = [];
  const has = (f: MovementFlag) => v.flags.includes(f);
  // Today the status badge says it; on a finished day the chip carries how long.
  if (!isToday && has("INSIDE_OFF_CLOCK"))
    out.push({ label: `Inside off the clock ${fmtDuration(v.lanes.totals.insideOffClockMin)}`, tone: "warning" });
  if (!isToday && has("NO_GATE_SCAN"))
    out.push({ label: `On the clock outside ${fmtDuration(v.lanes.totals.workOutsideMin)}`, tone: "warning" });
  if (has("LATE") && v.lateMinutes !== null) out.push({ label: `${fmtDuration(v.lateMinutes)} late`, tone: "warning" });
  if (has("LEFT_EARLY") && v.earlyMinutes !== null)
    out.push({ label: `Left ${fmtDuration(v.earlyMinutes)} early`, tone: "warning" });
  if (has("MULTIPLE_EXITS")) out.push({ label: `Out ${v.exits} times`, tone: "warning" });
  if (has("LONG_BREAK")) out.push({ label: `Break over ${LONG_BREAK_MIN} min`, tone: "warning" });
  if (has("EXIT_NO_ENTRY")) out.push({ label: "Exit with no entry scan", tone: "error" });
  if (has("MARKED_OUT")) out.push({ label: "Marked out overnight", tone: "neutral" });
  if (has("REJECTED")) out.push({ label: `${v.rejected} not counted`, tone: "neutral" });
  if (has("INACTIVE")) out.push({ label: "Inactive record", tone: "error" });
  return out;
}

/* ── The table ──────────────────────────────────────────────────────────── */

export function MovementsTable({
  views,
  data,
  now,
  stickyTop,
  shown,
  onShowMore,
  selectedId,
  onOpen,
  onZoom,
  isOpen,
  onToggle,
}: {
  /** Whether a person's scans are showing, and the way to show or hide them. */
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
  views: PersonDayView[];
  data: SiteDay;
  now: number;
  stickyTop: number;
  shown: number;
  onShowMore: () => void;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onZoom: (v: PersonDayView, src: string) => void;
}) {
  const isToday = data.day === data.today;
  const tz = data.site.timezone;
  const axis = useMemo(() => dayAxis(views, data, now), [views, data, now]);
  return (
    <section className={styles.group} aria-label="Movements">
      <div className={styles.mvHead} style={{ top: stickyTop }} aria-hidden="true">
        <span>Employee</span>
        <span className="flex min-w-0 flex-col gap-2">
          <span className={styles.mvAxis}>
            {axis.ticks.map((t) => (
              <span key={t} style={{ left: axis.pct(t) }}>
                {hourLabel(t, tz)}
              </span>
            ))}
          </span>
          <span className={styles.mvHeadLines}>
            <span>Reader</span>
            <span>Activity</span>
            <span>From</span>
            <span>To</span>
            <span className={styles.mvNum}>Duration</span>
          </span>
        </span>
      </div>
      <ol className={styles.mvList}>
        {views.slice(0, shown).map((v) => (
          <PersonBlock
            key={v.person.id}
            view={v}
            isToday={isToday}
            hasGate={data.site.hasGateData}
            tz={tz}
            now={now}
            selected={v.person.id === selectedId}
            onOpen={() => onOpen(v.person.id)}
            onZoom={(src) => onZoom(v, src)}
            axis={axis}
            scansOpen={isOpen(v.person.id)}
            onToggleScans={() => onToggle(v.person.id)}
          />
        ))}
      </ol>
      <div className={styles.logFoot}>
        <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-secondary)" }}>
          Showing {Math.min(shown, views.length).toLocaleString()} of {views.length.toLocaleString()}{" "}
          {views.length === 1 ? "person" : "people"}
          {data.truncated ? ". This day has more scans than one page holds, so the earliest are not shown." : ""}
        </span>
        {views.length > shown && (
          <Button hierarchy="secondary" size="sm" onClick={onShowMore}>
            Show {Math.min(PEOPLE_PER_PAGE, views.length - shown).toLocaleString()} more
          </Button>
        )}
      </div>
    </section>
  );
}

function PersonBlock({
  view: v,
  isToday,
  hasGate,
  tz,
  now,
  selected,
  onOpen,
  onZoom,
  axis,
  scansOpen,
  onToggleScans,
}: {
  scansOpen: boolean;
  onToggleScans: () => void;
  view: PersonDayView;
  isToday: boolean;
  hasGate: boolean;
  tz: string;
  now: number;
  selected: boolean;
  onOpen: () => void;
  onZoom: (src: string) => void;
  axis: Axis;
}) {
  const p = v.person;
  const status = statusOfDay(v, isToday, hasGate);
  const meta = status ? STATUS_META[status] : null;
  const chips = flagChips(v, isToday);
  const schedule = fmtShift(p.scheduledStart, p.scheduledEnd);
  const t = v.lanes.totals;

  return (
    <li>
      {/* The whole block opens the person; the face has its own click, to
          enlarge it, and the name is the keyboard's way in. */}
      <div className={styles.mvPerson} data-selected={selected ? "true" : undefined} onClick={onOpen}>
        <span className={styles.mvWho}>
          <span className={styles.mvPhoto}>
            <span className={styles.initials} aria-hidden="true">
              {initialsOf(p.name)}
            </span>
            <ZoomableFace src={p.photoUrl} name={p.name} onZoom={onZoom} />
            {meta && <span className={styles.stripe} style={{ background: meta.color, height: 4 }} />}
          </span>
          <span className={styles.mvIdentity}>
            <button
              type="button"
              className={styles.mvNameButton}
              aria-pressed={selected}
              title={`${p.name} · ${p.employeeCode}`}
            >
              {p.name}
            </button>
            <span className={styles.meta}>
              {p.employeeCode}
              {(p.jobTitle ?? p.department) ? ` · ${p.jobTitle ?? p.department}` : ""}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {meta && status && (
                <Badge tone={meta.badge} size="sm" dot>
                  {status === "ON_MEAL" ? (v.now.clock === "BREAK" ? "On break" : "On meal") : meta.label}
                </Badge>
              )}
              {p.onLeave && status !== "ON_LEAVE" && (
                <Badge tone="info" size="sm">
                  On leave
                </Badge>
              )}
              <HomeSiteBadge site={p.homeSite} />
            </span>
            <span className={styles.mvFacts}>
              {schedule ? `Scheduled ${schedule}` : "Not scheduled"}
            </span>
            {v.scanCount > 0 && hasGate && (
              <span className={styles.mvFacts}>{t.insideMin ? `Inside ${fmtDuration(t.insideMin)}` : "Never inside"}</span>
            )}
            {v.scanCount > 0 && (
              <span className={styles.mvFacts}>
                {t.workMin ? `On the clock ${fmtDuration(t.workMin)}` : "Never on the clock"}
              </span>
            )}
            {chips.length > 0 && (
              <span className={styles.mvChips}>
                {chips.map((c) => (
                  <Badge key={c.label} tone={c.tone} size="sm">
                    {c.label}
                  </Badge>
                ))}
              </span>
            )}
          </span>
        </span>

        <span className={styles.mvLines}>
          <Ribbon view={v} axis={axis} isToday={isToday} hasGate={hasGate} tz={tz} now={now} />
          {v.lines.length === 0 ? (
            <span className={styles.mvNone}>
              {p.onLeave
                ? "On approved leave. No scans."
                : v.schedule
                  ? isToday && now < v.schedule.start
                    ? `Not in yet. Due ${fmtTime(new Date(v.schedule.start).toISOString(), tz)}.`
                    : isToday
                      ? "Not seen at either reader today."
                      : "Not seen at either reader that day."
                  : "No stretches recorded, only scans that changed nothing."}
            </span>
          ) : (
            v.lines.map((l) => <Line key={l.key} line={l} isToday={isToday} tz={tz} />)
          )}
          {v.scanCount > 0 && (
            <>
              <button
                type="button"
                className={styles.scanToggle}
                aria-expanded={scansOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleScans();
                }}
              >
                <ChevronDown className={styles.chevron} aria-hidden="true" />
                {scansOpen ? "Hide" : "Show"} {v.scanCount.toLocaleString()} {v.scanCount === 1 ? "scan" : "scans"}
              </button>
              {scansOpen && <ScanList scans={v.scans} tz={tz} notCounted={v.notCounted} />}
            </>
          )}
        </span>
      </div>
    </li>
  );
}

/**
 * A person's scans, every one, in the order they happened, inside their
 * block: the same words the Scan log uses, so the two read alike.
 */
function ScanList({ scans, tz, notCounted }: { scans: PersonDayView["scans"]; tz: string; notCounted: number }) {
  return (
    <ol className={styles.scanList} onClick={(e) => e.stopPropagation()}>
      {scans.map((s) => {
        const { icon, kind } = iconFor(s);
        const gate = s.stream === "SECURITY";
        return (
          <li key={s.id} className={styles.scanItem}>
            <span className={styles.scanTime}>{fmtTime(s.at, tz)}</span>
            <span className={styles.eventIcon} data-kind={s.rejected ? "error" : kind} aria-hidden="true">
              {icon}
            </span>
            <span className="truncate" style={{ font: "var(--weight-medium) 13px/18px var(--font-sans)", color: "var(--text-primary)" }}>
              {describeScan(s)}
            </span>
            <span className={styles.source} data-stream={gate ? "gate" : "clock"}>
              {gate ? "Security gate" : "Time clock"}
            </span>
            <span className={styles.scanDevice}>{s.device ?? ""}</span>
            <span className={styles.scanNotes}>
              {s.automatic && (
                <Badge tone="neutral" size="sm">
                  Added by the system
                </Badge>
              )}
            </span>
          </li>
        );
      })}
      {notCounted > 0 && (
        <li className={styles.scanHidden}>
          {notCounted.toLocaleString()} more {notCounted === 1 ? "scan was" : "scans were"} not counted: refused by the
          timecard or read twice. They are in the Scan log under Not counted.
        </li>
      )}
    </ol>
  );
}

/* ── The day ribbon ─────────────────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;

interface Axis {
  from: number;
  to: number;
  ticks: number[];
  pct: (t: number) => string;
  width: (a: number, b: number) => string;
}

/**
 * One clock for the whole table, so every person's ribbon lines up with the
 * next and a glance down the page shows who left at noon. It spans whatever
 * part of the day anybody on the list was scheduled or seen, in whole hours,
 * never less than eight. On today that runs to now, or further where
 * somebody is scheduled later, so the rest of their shift shows ahead.
 */
function dayAxis(views: PersonDayView[], data: SiteDay, now: number): Axis {
  const dayStart = Date.parse(data.dayStart);
  const dayEnd = Date.parse(data.dayEnd);
  const isToday = data.day === data.today;
  let lo = Infinity;
  let hi = -Infinity;
  const see = (t: number | null | undefined) => {
    if (t == null || !Number.isFinite(t)) return;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  };
  for (const v of views) {
    for (const s of v.scans) see(Date.parse(s.at));
    if (v.schedule) {
      see(v.schedule.start);
      see(Math.min(v.schedule.end, dayEnd));
    }
    if (v.lines.some((l) => l.carried)) see(dayStart);
  }
  if (isToday) see(Math.min(now, dayEnd));
  if (!Number.isFinite(lo)) {
    lo = dayStart + 6 * HOUR;
    hi = dayStart + 18 * HOUR;
  }
  let from = Math.max(dayStart, Math.floor(lo / HOUR) * HOUR);
  let to = Math.min(dayEnd, Math.ceil(hi / HOUR) * HOUR);
  if (to - from < 8 * HOUR) {
    to = Math.min(from + 8 * HOUR, dayEnd);
    from = Math.max(to - 8 * HOUR, dayStart);
  }
  const span = Math.max(to - from, HOUR);
  const step = span <= 10 * HOUR ? 1 * HOUR : span <= 16 * HOUR ? 2 * HOUR : 3 * HOUR;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  const clamp = (t: number) => Math.min(Math.max(t, from), to);
  return {
    from,
    to,
    ticks,
    pct: (t) => `${(((clamp(t) - from) / span) * 100).toFixed(3)}%`,
    width: (a, b) => `${(((clamp(b) - clamp(a)) / span) * 100).toFixed(3)}%`,
  };
}

const hourFmt = new Map<string, Intl.DateTimeFormat>();
function hourLabel(ms: number, tz: string): string {
  let f = hourFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: true });
    hourFmt.set(tz, f);
  }
  return f.format(new Date(ms));
}

/**
 * A person's day at a glance, above their lines: the gate on top, the time
 * clock under it, the scheduled hours as an outline behind both, and a tick
 * for every single scan, so a burst of scans or a scan that changed nothing
 * is visible without opening anything.
 */
function Ribbon({
  view: v,
  axis,
  isToday,
  hasGate,
  tz,
  now,
}: {
  view: PersonDayView;
  axis: Axis;
  isToday: boolean;
  hasGate: boolean;
  tz: string;
  now: number;
}) {
  const time = (ms: number) => fmtTime(new Date(ms).toISOString(), tz);
  const nowAt = isToday && now > axis.from && now < axis.to ? axis.pct(now) : null;
  const tick = (s: PersonDayView["scans"][number]) => (
    <span
      key={s.id}
      className={styles.rbTick}
      data-kind={s.rejected ? "error" : s.automatic ? "system" : undefined}
      style={{ left: axis.pct(Date.parse(s.at)) }}
      title={`${time(Date.parse(s.at))} ${s.stream === "SECURITY" ? "security gate" : "time clock"}${
        s.rejected ? ", not accepted" : s.automatic ? ", added by the system" : ""
      }`}
    />
  );
  return (
    <span className={styles.rb} data-single={hasGate ? undefined : "true"} aria-hidden="true">
      {v.schedule && (
        <span
          className={styles.rbSched}
          style={{ left: axis.pct(v.schedule.start), width: axis.width(v.schedule.start, v.schedule.end) }}
          title={`Scheduled ${time(v.schedule.start)} to ${time(v.schedule.end)}`}
        />
      )}
      {hasGate && (
        <span className={styles.rbTrack} data-lane="gate">
          {v.lanes.gate.map((g) => (
            <span
              key={g.start}
              className={styles.rbSeg}
              data-kind="inside"
              style={{ left: axis.pct(g.start), width: axis.width(g.start, g.end) }}
              title={`Inside ${time(g.start)} to ${g.open ? (isToday ? "now" : "the end of the day") : time(g.end)}`}
            />
          ))}
          {v.scans.filter((s) => s.stream === "SECURITY").map(tick)}
        </span>
      )}
      <span className={styles.rbTrack} data-lane="clock">
        {v.lanes.clock.map((c) => (
          <span
            key={c.start}
            className={styles.rbSeg}
            data-kind={c.kind === "WORK" ? "work" : "meal"}
            style={{ left: axis.pct(c.start), width: axis.width(c.start, c.end) }}
            title={`${c.kind === "WORK" ? "On the clock" : c.kind === "MEAL" ? "Meal" : "Break"} ${time(c.start)} to ${
              c.open ? (isToday ? "now" : "the end of the day") : time(c.end)
            }`}
          />
        ))}
        {v.scans.filter((s) => s.stream === "TIME_CLOCK").map(tick)}
      </span>
      {nowAt && <span className={styles.rbNow} style={{ left: nowAt }} />}
    </span>
  );
}

const KIND_LABEL: Record<MovementLine["kind"], string> = {
  INSIDE: "Inside the building",
  WORK: "On the clock",
  MEAL: "Meal",
  BREAK: "Break",
  EXIT_ONLY: "Exit, no entry scan",
};

const STILL: Record<MovementLine["kind"], string> = {
  INSIDE: "Still inside",
  WORK: "Still on the clock",
  MEAL: "Still on meal",
  BREAK: "Still on break",
  EXIT_ONLY: "",
};

function Line({ line: l, isToday, tz }: { line: MovementLine; isToday: boolean; tz: string }) {
  const gate = l.reader === "gate";
  const time = (ms: number) => fmtTime(new Date(ms).toISOString(), tz);
  const long = (l.kind === "MEAL" || l.kind === "BREAK") && l.minutes > LONG_BREAK_MIN;

  return (
    <span className={styles.mvLine} data-kind={l.kind}>
      <span className={styles.mvCell}>
        <span className={styles.source} data-stream={gate ? "gate" : "clock"}>
          {gate ? <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" /> : <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
          {gate ? "Security gate" : "Time clock"}
        </span>
      </span>
      <span className={`${styles.mvCell} ${styles.mvWhat}`}>
        <span className={styles.mvKind} data-kind={l.kind} aria-hidden="true" />
        <span className="truncate">{KIND_LABEL[l.kind]}</span>
      </span>
      <span className={`${styles.mvCell} ${styles.mvTime}`}>
        {l.kind === "EXIT_ONLY" ? (
          <span className={styles.mvQuiet}>No entry</span>
        ) : l.carried ? (
          <span className={styles.mvQuiet}>Before midnight</span>
        ) : (
          <>
            <span>{l.start !== null ? time(l.start) : ""}</span>
            {l.startDevice && <span className={styles.mvDevice}>{l.startDevice}</span>}
          </>
        )}
      </span>
      <span className={`${styles.mvCell} ${styles.mvTime}`}>
        {l.end === null ? (
          isToday ? (
            <span className={styles.mvStill}>{STILL[l.kind]}</span>
          ) : (
            <span className={styles.mvWarn}>No scan out</span>
          )
        ) : (
          <>
            <span>{time(l.end)}</span>
            {l.closedBySystem ? (
              <span className={styles.mvWarnSmall}>Marked out by the system</span>
            ) : (
              l.endDevice && <span className={styles.mvDevice}>{l.endDevice}</span>
            )}
          </>
        )}
      </span>
      <span className={`${styles.mvCell} ${styles.mvNum}`} data-long={long ? "true" : undefined}>
        {l.kind === "EXIT_ONLY" ? "" : fmtDuration(l.minutes)}
      </span>
    </span>
  );
}

/* ── States ─────────────────────────────────────────────────────────────── */

export function MovementsEmpty({ when, filtered, onClear }: { when: string; filtered: boolean; onClear: () => void }) {
  if (filtered) {
    return (
      <EmptyState
        icon={<UserRoundX className="h-8 w-8" />}
        title="No matching people"
        body={`Nobody ${when} matches what you have picked. Clear the filters to see everyone.`}
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
      icon={<UserRoundX className="h-8 w-8" />}
      title={when === "today" ? "Nobody here yet today" : `Nobody ${when}`}
      body={
        when === "today"
          ? "People appear here as they are scheduled, scan in, or go on leave."
          : "Nobody was scheduled, on leave or seen at a reader that day."
      }
    />
  );
}

export function MovementsSkeleton() {
  const bar = (w: string | number, h: number, r?: number) => (
    <span className={styles.skeleton} style={{ width: w, height: h, borderRadius: r }} />
  );
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading movements">
    <div className={`${styles.headcount} ${styles.headcountEven}`}>
      {[5, 9].map((n) => (
        <div key={n} className={styles.side}>
          {bar(n === 5 ? 220 : 140, n === 5 ? 44 : 20)}
          <div className={`${styles.counters} ${styles.flagCounters}`}>
            {Array.from({ length: n }, (_, i) => (
              <span key={i}>{bar("100%", 58)}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
    <div className={styles.group}>
      <div className={styles.mvHead}>{bar(120, 12)}</div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex gap-4 border-b px-4 py-4" style={{ borderColor: "var(--stroke-divider)" }}>
          {bar(64, 72, 10)}
          <span className="flex w-40 flex-col gap-2">
            {bar("90%", 14)}
            {bar("60%", 12)}
            {bar("50%", 18)}
          </span>
          <span className="flex flex-1 flex-col gap-3">
            {bar("100%", 16)}
            {bar("100%", 16)}
          </span>
        </div>
      ))}
    </div>
    </div>
  );
}

/* ── Filters ────────────────────────────────────────────────────────────── */

type Tone = "warning" | "error" | "neutral" | "info" | "purple";

/** Names for each filter, standard and short, with the one line that explains it. */
export const FLAG_META: Record<MovementFlag, { label: string; hint: string; tone: Tone }> = {
  INSIDE_OFF_CLOCK: {
    label: "Inside, not clocked in",
    hint: "Through the security gate and not on the clock. On a past day, 15 minutes or more of it",
    tone: "purple",
  },
  NO_GATE_SCAN: {
    label: "Clocked in, no gate scan",
    hint: "On the clock while the security gate has them outside. On a past day, 15 minutes or more of it",
    tone: "warning",
  },
  SCHEDULED_OUTSIDE: {
    label: "Scheduled now, outside",
    hint: "Inside their scheduled hours right now and not in the building",
    tone: "warning",
  },
  ON_BREAK: { label: "On meal or break", hint: "Clocked out for a meal or a rest break right now", tone: "warning" },
  NOT_ARRIVED: { label: "Not arrived", hint: "Scheduled and not seen at either reader", tone: "neutral" },
  LATE: { label: "Late", hint: "First scan more than 5 minutes after the scheduled start", tone: "warning" },
  LEFT_EARLY: { label: "Left early", hint: "Last scan out more than 5 minutes before the scheduled end", tone: "warning" },
  MULTIPLE_EXITS: { label: "Out more than once", hint: "Left through the security gate two or more times", tone: "warning" },
  LONG_BREAK: { label: `Break over ${LONG_BREAK_MIN} min`, hint: `A meal or break that ran past ${LONG_BREAK_MIN} minutes`, tone: "warning" },
  EXIT_NO_ENTRY: { label: "Exit, no entry scan", hint: "Left through the security gate without being seen coming in", tone: "error" },
  MARKED_OUT: { label: "Marked out overnight", hint: "Never scanned out, so the system closed their day", tone: "neutral" },
  REJECTED: {
    label: "Scans not counted",
    hint: "Had scans the timecard refused, usually a second tap too soon. They are left out of the lists and totals",
    tone: "neutral",
  },
  INACTIVE: { label: "Inactive record", hint: "Scanning on a record that is inactive or terminated", tone: "error" },
  ON_LEAVE: { label: "On leave", hint: "Approved time off that day", tone: "info" },
};

const NOW_FLAGS: MovementFlag[] = ["INSIDE_OFF_CLOCK", "NO_GATE_SCAN", "SCHEDULED_OUTSIDE", "ON_BREAK", "NOT_ARRIVED"];
const PAST_FLAGS: MovementFlag[] = ["INSIDE_OFF_CLOCK", "NO_GATE_SCAN", "NOT_ARRIVED"];
const DAY_FLAGS: MovementFlag[] = [
  "LATE",
  "LEFT_EARLY",
  "MULTIPLE_EXITS",
  "LONG_BREAK",
  "EXIT_NO_ENTRY",
  "MARKED_OUT",
  "REJECTED",
  "INACTIVE",
  "ON_LEAVE",
];

/** Which filters make sense for this day and this site. */
export function flagsFor(isToday: boolean, hasGate: boolean): MovementFlag[] {
  const first = (isToday ? NOW_FLAGS : PAST_FLAGS).filter(
    (f) => hasGate || (f !== "INSIDE_OFF_CLOCK" && f !== "NO_GATE_SCAN"),
  );
  const rest = DAY_FLAGS.filter((f) => hasGate || (f !== "MULTIPLE_EXITS" && f !== "EXIT_NO_ENTRY"));
  return [...first, ...rest];
}

export function parseFlag(raw: string | null | undefined): MovementFlag | null {
  return raw && raw in FLAG_META ? (raw as MovementFlag) : null;
}

const TONE_COLOR: Record<Tone, string> = {
  warning: "var(--fill-warning)",
  error: "var(--fill-error)",
  neutral: "var(--stroke-default)",
  info: "var(--text-accent)",
  purple: "var(--ps-offclock)",
};

/**
 * The counts above the table, drawn like the People headcount: a big number,
 * then counters that are also the filters. The left side is where people are
 * right now (on a past day, how the day went between the readers); the right
 * side is everything else worth a look that day.
 */
export function MovementsCounts({
  views,
  counts,
  isToday,
  hasGate,
  flag,
  onPick,
  when,
  totals,
  onJump,
}: {
  views: PersonDayView[];
  counts: Record<MovementFlag, number>;
  isToday: boolean;
  hasGate: boolean;
  flag: MovementFlag | null;
  onPick: (f: MovementFlag | null) => void;
  when: string;
  totals: ScanTotals;
  /** Opens the Scan log, narrowed to the number clicked. */
  onJump: (c: LogCounter | null) => void;
}) {
  const available = flagsFor(isToday, hasGate);
  const first = available.filter((f) => (isToday ? NOW_FLAGS : PAST_FLAGS).includes(f));
  const rest = available.filter((f) => DAY_FLAGS.includes(f));
  const insideNow = views.filter((v) => (hasGate ? v.now.inside : v.now.clock !== "OUT")).length;
  const seen = views.filter((v) => v.scanCount > 0).length;
  const pick = (f: MovementFlag) => onPick(flag === f ? null : f);

  return (
    <section className={`${styles.headcount} ${styles.headcountEven}`} aria-label="Filters">
      <div className={styles.side}>
        <button type="button" className={styles.total} aria-pressed={flag === null} onClick={() => onPick(null)}>
          <span className={styles.totalFigure}>{(isToday ? insideNow : seen).toLocaleString()}</span>
          <span className={styles.totalLabel}>
            {isToday
              ? hasGate
                ? `${insideNow === 1 ? "person" : "people"} in the building`
                : `${insideNow === 1 ? "person" : "people"} on the clock`
              : `${seen === 1 ? "person" : "people"} seen ${when}`}
          </span>
        </button>
        <div className={`${styles.counters} ${styles.flagCounters}`}>
          {first.map((f) => (
            <FlagCounter key={f} flag={f} count={counts[f]} active={flag === f} onClick={() => pick(f)} />
          ))}
        </div>
      </div>
      <div className={styles.side}>
        <span style={{ font: "var(--type-h4)", color: "var(--text-secondary)" }}>
          {isToday ? "During the day" : `During the day, ${when}`}
        </span>
        <div className={`${styles.counters} ${styles.flagCounters}`}>
          {rest.map((f) => (
            <FlagCounter key={f} flag={f} count={counts[f]} active={flag === f} onClick={() => pick(f)} />
          ))}
        </div>
      </div>

      {/* Every scan behind the table, counted the way the Scan log counts
          them, and each number a way into that log. */}
      <div className={styles.scanTotals}>
        <span className={styles.scanTotalsLabel}>Scans {when}</span>
        <TotalLink figure={totals.all} label={totals.all === 1 ? "scan" : "scans"} onClick={() => onJump(null)} strong />
        {hasGate && (
          <span className={styles.scanTotalsGroup}>
            <DoorOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <TotalLink figure={totals.gate} label="security gate" onClick={() => onJump("gate")} />
            <TotalLink figure={totals.gateIn} label="in" onClick={() => onJump("gate-in")} quiet />
            <TotalLink figure={totals.gateOut} label="out" onClick={() => onJump("gate-out")} quiet />
          </span>
        )}
        <span className={styles.scanTotalsGroup}>
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <TotalLink figure={totals.clock} label="time clock" onClick={() => onJump("clock")} />
          <TotalLink figure={totals.clockIn} label="in" onClick={() => onJump("clock-in")} quiet />
          <TotalLink figure={totals.clockOut} label="out" onClick={() => onJump("clock-out")} quiet />
          {totals.rejected > 0 && (
            <TotalLink figure={totals.rejected} label="not counted" onClick={() => onJump("rejected")} quiet />
          )}
        </span>
      </div>
    </section>
  );
}

function TotalLink({
  figure,
  label,
  onClick,
  strong,
  quiet,
}: {
  figure: number;
  label: string;
  onClick: () => void;
  strong?: boolean;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.totalLink}
      data-strong={strong ? "true" : undefined}
      data-quiet={quiet ? "true" : undefined}
      onClick={onClick}
      title={`Open the Scan log for these ${label === "in" || label === "out" ? `scans ${label}` : `${label} scans`}`}
    >
      <span className={styles.totalLinkFigure}>{figure.toLocaleString()}</span> {label}
    </button>
  );
}

function FlagCounter({
  flag,
  count,
  active,
  onClick,
}: {
  flag: MovementFlag;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const meta = FLAG_META[flag];
  return (
    <button
      type="button"
      className={styles.counter}
      aria-pressed={active}
      data-empty={count === 0 ? "true" : undefined}
      onClick={onClick}
      title={meta.hint}
    >
      <span className={styles.counterFigure}>{count.toLocaleString()}</span>
      <span className={styles.counterLabel}>
        <span className={styles.dot} style={{ background: TONE_COLOR[meta.tone] }} aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    </button>
  );
}

/* ── Sorting ────────────────────────────────────────────────────────────── */

export type MvSort = "name" | "department" | "arrival" | "latest" | "inside" | "flags";

export const MV_SORTS: { key: MvSort; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "department", label: "Department" },
  { key: "arrival", label: "Arrival time" },
  { key: "latest", label: "Latest activity" },
  { key: "inside", label: "Time inside" },
  { key: "flags", label: "Most flags" },
];

export function parseMvSort(raw: string | null | undefined): MvSort {
  return MV_SORTS.some((s) => s.key === raw) ? (raw as MvSort) : "name";
}

/**
 * The order of the table. Anything missing (never arrived, no department)
 * goes last, and ties fall back to the name, so the order never jumps about
 * between refreshes.
 */
export function compareDays(sort: MvSort): (a: PersonDayView, b: PersonDayView) => number {
  const name = (a: PersonDayView, b: PersonDayView) => a.person.name.localeCompare(b.person.name);
  const nullsLast = (x: number | null, y: number | null, dir: 1 | -1) =>
    x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : dir * (x - y);
  switch (sort) {
    case "department":
      return (a, b) =>
        (a.person.department ?? "￿").localeCompare(b.person.department ?? "￿") || name(a, b);
    case "arrival":
      return (a, b) => nullsLast(a.firstIn, b.firstIn, 1) || name(a, b);
    case "latest":
      return (a, b) => nullsLast(a.lastActivity, b.lastActivity, -1) || name(a, b);
    case "inside":
      return (a, b) => b.lanes.totals.insideMin - a.lanes.totals.insideMin || name(a, b);
    case "flags":
      return (a, b) => b.flags.filter((f) => f !== "ON_LEAVE").length - a.flags.filter((f) => f !== "ON_LEAVE").length || name(a, b);
    default:
      return name;
  }
}
