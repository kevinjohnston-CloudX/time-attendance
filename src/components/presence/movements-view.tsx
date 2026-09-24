"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ChevronDown, ChevronRight, UserRoundX } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { getOnSiteMovements } from "@/actions/presence.actions";
import type { PresenceStatus, SiteDay } from "@/lib/presence/types";
import {
  GAP_MIN,
  LONG_BREAK_MIN,
  type MovementFlag,
  type PersonDayView,
  type ScanTotals,
} from "@/lib/presence/movements";
import type { LogCounter } from "./scan-log";
import { STATUS_META, describeOriginal, describeScan, fmtDuration, fmtTime, initialsOf } from "./presence-meta";
import { iconFor } from "./person-panel";
import { leftBuilding } from "@/lib/presence/lanes";
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
  if (inside) return v.person.salaried ? "ON_SITE" : "OFF_CLOCK";
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
    out.push({ label: `Inside, not clocked in ${fmtDuration(v.lanes.totals.insideOffClockMin)}`, tone: "warning" });
  if (!isToday && has("NO_GATE_SCAN"))
    out.push({ label: `Clocked in, not inside ${fmtDuration(v.lanes.totals.workOutsideMin)}`, tone: "warning" });
  if (has("LATE") && v.lateMinutes !== null) out.push({ label: `${fmtDuration(v.lateMinutes)} late`, tone: "warning" });
  if (has("LEFT_EARLY") && v.earlyMinutes !== null)
    out.push({ label: `Left ${fmtDuration(v.earlyMinutes)} early`, tone: "warning" });
  if (has("MULTIPLE_EXITS")) out.push({ label: `Left ${v.exits} times`, tone: "warning" });
  if (has("LONG_BREAK")) out.push({ label: "Long break", tone: "warning" });
  if (has("EXIT_NO_ENTRY")) out.push({ label: "Left, never scanned in", tone: "error" });
  if (has("MARKED_OUT")) out.push({ label: "Never scanned out", tone: "neutral" });
  if (has("REJECTED")) out.push({ label: `${v.rejected} ${v.rejected === 1 ? "tap" : "taps"} not counted`, tone: "neutral" });
  if (has("INACTIVE")) out.push({ label: "Inactive employee", tone: "error" });
  return out;
}

/* ── The table ──────────────────────────────────────────────────────────── */

/**
 * One row per person, the same columns for everybody, so the list reads
 * down: who, when they came in against when they were due, when they left
 * against when they were due to, how long inside and how long on the clock,
 * and the day at a glance. The detail behind those numbers (every stretch at
 * each reader, every scan, the device that took it) folds out under the row.
 */
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
  newCount = 0,
  onShowNew,
}: {
  /** People who moved since the order was last set, and the way to bring them up. */
  newCount?: number;
  onShowNew?: () => void;
  /** Whether a person's detail is showing, and the way to show or hide it. */
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
  const hasGate = data.site.hasGateData;
  const axis = useMemo(() => dayAxis(data), [data]);
  return (
    <section className={styles.group} aria-label="Movements" style={{ scrollMarginTop: stickyTop + 8 }}>
      <div className={styles.mvHeadWrap} style={{ top: stickyTop }}>
      <div className={styles.mvHead} data-gate={hasGate ? undefined : "false"} aria-hidden="true">
        <span>Employee</span>
        <span>Arrived</span>
        <span>Left</span>
        {hasGate && <span className={styles.mvNum}>In building</span>}
        <span className={styles.mvNum}>On the clock</span>
        <span className={styles.mvAxis}>
          {axis.ticks.map((t) => (
            <span key={t} style={{ left: axis.pct(t) }} data-edge={t === axis.from ? "start" : t === axis.to ? "end" : undefined}>
              {hourLabel(t, tz)}
            </span>
          ))}
        </span>
        <span />
      </div>
      {newCount > 0 && onShowNew && (
        <button type="button" className={styles.mvNewPill} onClick={onShowNew}>
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          {newCount.toLocaleString()} new {newCount === 1 ? "movement" : "movements"}
        </button>
      )}
      </div>
      <ol className={styles.mvList}>
        {views.slice(0, shown).map((v) => (
          <PersonRow
            key={v.person.id}
            view={v}
            isToday={isToday}
            hasGate={hasGate}
            tz={tz}
            now={now}
            selected={v.person.id === selectedId}
            onOpen={() => onOpen(v.person.id)}
            onZoom={(src) => onZoom(v, src)}
            axis={axis}
            open={isOpen(v.person.id)}
            onToggle={() => onToggle(v.person.id)}
            dayStart={Date.parse(data.dayStart)}
            dayEnd={Date.parse(data.dayEnd)}
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

function PersonRow({
  view: v,
  isToday,
  hasGate,
  tz,
  now,
  selected,
  onOpen,
  onZoom,
  axis,
  open,
  onToggle,
  dayStart,
  dayEnd,
}: {
  open: boolean;
  onToggle: () => void;
  dayStart: number;
  dayEnd: number;
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
  const t = v.lanes.totals;
  const time = (ms: number) => fmtTime(new Date(ms).toISOString(), tz);
  const seen = v.scanCount > 0;
  // The same rule as the panel's Left card: the gate says whether they are in
  // the building, the time clock only whether their day is over.
  const where = leftBuilding(v.lanes, hasGate);
  const present = isToday && where.onSite;
  const stillOn =
    where.leftAt !== null && where.clock !== "OUT"
      ? isToday
        ? { MEAL: "On meal", BREAK: "On break", WORK: "Still clocked in" }[where.clock]
        : "Never clocked out"
      : null;
  const late = v.flags.includes("LATE");
  const early = v.flags.includes("LEFT_EARLY");
  const carried = v.lines.some((l) => l.carried);
  const unclosed = !isToday && v.lines.some((l) => l.end === null && l.kind !== "EXIT_ONLY");
  const hasDetail = seen || v.lines.length > 0;

  const arrived =
    v.firstIn !== null ? (
      <span data-tone={late ? "warning" : undefined}>{time(v.firstIn)}</span>
    ) : carried ? (
      <span className={styles.mvQuiet}>Since yesterday</span>
    ) : p.onLeave ? (
      <span className={styles.mvQuiet}>On leave</span>
    ) : v.schedule ? (
      <span className={styles.mvQuiet}>{isToday && now < v.schedule.start ? "Not in yet" : "Not in"}</span>
    ) : null;

  const left = present ? (
    <span className={styles.mvHere}>On site</span>
  ) : where.leftAt !== null ? (
    <span data-tone={early ? "warning" : undefined}>{time(where.leftAt)}</span>
  ) : unclosed ? (
    <span className={styles.mvWarn}>Never scanned out</span>
  ) : null;

  return (
    <li>
      {/* The row opens the person's panel; the face has its own click, to
          enlarge it, the name is the keyboard's way in, and the arrow at the
          end folds the detail out in place. */}
      <div
        className={styles.mvRow}
        data-gate={hasGate ? undefined : "false"}
        data-selected={selected ? "true" : undefined}
        data-open={open ? "true" : undefined}
        onClick={onOpen}
      >
        <span className={styles.mvWho}>
          <span className={styles.mvPhoto}>
            <span className={styles.initials} aria-hidden="true">
              {initialsOf(p.name)}
            </span>
            <ZoomableFace src={p.photoUrl} personId={p.id} name={p.name} onZoom={onZoom} />
            {meta && <span className={styles.stripe} style={{ background: meta.color, height: 3 }} />}
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
              {p.jobTitle ?? p.department ?? p.employeeCode}
              {p.salaried ? " · Salary" : ""}
            </span>
            <span className={styles.mvBadges}>
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
              {chips.map((c) => (
                <Badge key={c.label} tone={c.tone} size="sm">
                  {c.label}
                </Badge>
              ))}
              <HomeSiteBadge site={p.homeSite} />
            </span>
          </span>
        </span>

        <span className={styles.mvFact}>
          <span className={styles.mvFactValue}>{arrived}</span>
          {v.schedule && <span className={styles.mvFactSub}>Due {time(v.schedule.start)}</span>}
        </span>
        <span className={styles.mvFact}>
          <span className={styles.mvFactValue}>{left}</span>
          {stillOn ? (
            <span className={styles.mvFactSub}>{stillOn}</span>
          ) : (
            v.schedule && <span className={styles.mvFactSub}>Ends {time(v.schedule.end)}</span>
          )}
        </span>
        {hasGate && (
          <span className={`${styles.mvFact} ${styles.mvNum}`}>
            <span className={styles.mvFactValue}>{seen ? fmtDuration(t.insideMin) : ""}</span>
          </span>
        )}
        <span className={`${styles.mvFact} ${styles.mvNum}`}>
          {/* No clock time is normal for salaried people, who do not clock
              in, and a gap for anyone hourly; neither reads as "0 min". */}
          {seen && t.workMin === 0 ? (
            <span className={styles.mvQuiet}>{v.person.salaried ? "Salary" : "Not clocked in"}</span>
          ) : (
            <span className={styles.mvFactValue}>{seen ? fmtDuration(t.workMin) : ""}</span>
          )}
        </span>
        <span className={styles.mvDay}>
          <Ribbon view={v} axis={axis} isToday={isToday} hasGate={hasGate} tz={tz} now={now} />
        </span>
        <span className={styles.mvToggleCell}>
          {hasDetail && (
            <button
              type="button"
              className={styles.mvToggle}
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} details for ${p.name}`}
              title={open ? "Hide details" : "Show details"}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>

      {open && hasDetail && (
        <DayStory view={v} isToday={isToday} hasGate={hasGate} tz={tz} now={now} dayStart={dayStart} dayEnd={dayEnd} />
      )}
    </li>
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
 * One clock for the whole table, so every person's day bar lines up with the
 * next and a glance down the page shows who left at noon. Always the whole
 * day, 12 AM to 12 AM, labelled every six hours, so the scale is the same
 * on every site and every day and nobody's time falls off an edge.
 */
function dayAxis(data: SiteDay): Axis {
  const from = Date.parse(data.dayStart);
  const to = Date.parse(data.dayEnd);
  const span = Math.max(to - from, HOUR);
  const ticks: number[] = [];
  for (let t = from; t <= to; t += 6 * HOUR) ticks.push(t);
  // A day that loses or gains an hour to daylight saving still ends labelled.
  if (ticks[ticks.length - 1] !== to) ticks.push(to);
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
 * A person's day at a glance, drawn the way the employee panel draws it: the
 * scheduled hours as a thin line above, the gate and the time clock as two
 * rounded bars, a meal as a notch in the clock bar, and, today, both bars
 * stopping at now with the rest of the shift as an outline. Every scan is in
 * the detail under the row.
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
  const clampNow = Math.min(Math.max(now, axis.from), axis.to);
  const recordedTo = isToday ? clampNow : axis.to;
  const nowAt = isToday && now > axis.from && now < axis.to ? axis.pct(now) : null;
  const ahead =
    isToday && v.schedule && v.schedule.end > recordedTo
      ? { start: Math.max(recordedTo, v.schedule.start), end: v.schedule.end }
      : null;
  // A stretch still running is pinned to now from the right, so a meal that
  // has only just started grows back into the bar, never past the now line.
  const place = (s: { start: number; end: number; open: boolean }) =>
    s.open && isToday
      ? { right: `calc(100% - ${axis.pct(s.end)})`, width: axis.width(s.start, s.end) }
      : { left: axis.pct(s.start), width: axis.width(s.start, s.end) };
  const clock = [...v.lanes.clock].sort((a, b) => a.start - b.start);
  const until = (s: { end: number; open: boolean }) =>
    s.open ? (isToday ? "now" : "the end of the day") : time(s.end);

  const lane = (key: string, children: ReactNode) => (
    <span className={styles.rbLane} key={key}>
      <span className={styles.rbBg} style={{ width: axis.width(axis.from, recordedTo) }} />
      {ahead && <span className={styles.rbAhead} style={{ left: axis.pct(ahead.start), width: axis.width(ahead.start, ahead.end) }} />}
      {children}
    </span>
  );

  return (
    <span className={styles.rb2} data-single={hasGate ? undefined : "true"}>
      <span className={styles.rbSchedRow}>
        {v.schedule && (
          <span
            className={styles.rbSchedLine}
            style={{ left: axis.pct(v.schedule.start), width: axis.width(v.schedule.start, v.schedule.end) }}
            title={`Scheduled ${time(v.schedule.start)} to ${time(v.schedule.end)}`}
          />
        )}
      </span>
      {hasGate &&
        lane(
          "gate",
          v.lanes.gate.map((g) => (
            <span
              key={g.start}
              className={styles.rbPiece}
              data-kind="inside"
              data-first="true"
              data-last={g.open && isToday ? undefined : "true"}
              style={place(g)}
              title={`Inside ${time(g.start)} to ${until(g)}`}
            />
          )),
        )}
      {lane(
        "clock",
        clock.map((c, i) => {
          const first = i === 0 || clock[i - 1].end !== c.start;
          const last = i === clock.length - 1 || clock[i + 1].start !== c.end;
          return (
            <span
              key={c.start}
              className={styles.rbPiece}
              data-kind={c.kind === "WORK" ? "work" : "meal"}
              data-first={first ? "true" : undefined}
              data-last={last && !(c.open && isToday) ? "true" : undefined}
              style={place(c)}
              title={`${c.kind === "WORK" ? "On the clock" : c.kind === "MEAL" ? "Meal" : "Break"} ${time(c.start)} to ${until(c)}`}
            />
          );
        }),
      )}
      {nowAt && <span className={styles.rbNow2} style={{ left: nowAt }} aria-hidden="true" />}
    </span>
  );
}

/* ── A person's day, as a story ─────────────────────────────────────────── */

type StoryState = "WORKING" | "MEAL" | "BREAK" | "INSIDE_OFF" | "ON_SITE" | "OUT_WORKING" | "OUT_MEAL" | "OUTSIDE";

const STATE_LABEL: Record<StoryState, string> = {
  WORKING: "Working",
  MEAL: "On meal",
  BREAK: "On break",
  INSIDE_OFF: "Inside, not clocked in",
  ON_SITE: "On site",
  OUT_WORKING: "Clocked in, not inside",
  OUT_MEAL: "On a break, outside",
  OUTSIDE: "Out of the building",
};

/** A stretch this short between two scans says nothing worth a line. */
const QUIET_MS = 2 * 60 * 1000;

interface StoryNode {
  key: string;
  at: number;
  /** "Yesterday", "Now", "End of day", or the time. */
  when: string;
  text: string;
  meta: string | null;
  kind: "in" | "out" | "meal" | "system" | "now" | "end";
  note: string | null;
}

interface StoryLink {
  state: StoryState;
  minutes: number;
  running: boolean;
  worth: boolean;
}

/**
 * What the person was doing at a moment, from both readers at once: the gate
 * says in or out of the building, the clock says working, on a meal or off.
 */
function stateAt(v: PersonDayView, t: number, hasGate: boolean): StoryState | null {
  const inside = hasGate ? v.lanes.gate.some((g) => g.start <= t && t < g.end) : true;
  const c = v.lanes.clock.find((s) => s.start <= t && t < s.end);
  const clock = c ? c.kind : "OUT";
  if (inside) {
    if (clock === "WORK") return "WORKING";
    if (clock === "MEAL") return "MEAL";
    if (clock === "BREAK") return "BREAK";
    if (!hasGate) return null;
    return v.person.salaried ? "ON_SITE" : "INSIDE_OFF";
  }
  if (clock === "WORK") return "OUT_WORKING";
  if (clock === "MEAL" || clock === "BREAK") return "OUT_MEAL";
  return "OUTSIDE";
}

function linkWorth(state: StoryState, minutes: number): boolean {
  if (state === "INSIDE_OFF" || state === "OUT_WORKING") return minutes >= GAP_MIN;
  if (state === "MEAL" || state === "BREAK" || state === "OUT_MEAL") return minutes > LONG_BREAK_MIN;
  return false;
}

function buildStory(v: PersonDayView, isToday: boolean, hasGate: boolean, now: number, dayStart: number, dayEnd: number, tz: string) {
  const time = (ms: number) => fmtTime(new Date(ms).toISOString(), tz);
  const exitOnly = new Set(v.lanes.exitsWithoutEntry.map((s) => s.id));
  const nodes: StoryNode[] = [];

  const carried = v.lines.some((l) => l.carried);
  if (carried) {
    const s = stateAt(v, dayStart, hasGate);
    nodes.push({
      key: "carried",
      at: dayStart,
      when: "Yesterday",
      text: s === "WORKING" ? "Still on the clock from yesterday" : "Still inside from yesterday",
      meta: null,
      kind: "in",
      note: null,
    });
  }

  for (const s of [...v.scans].sort((a, b) => a.at.localeCompare(b.at))) {
    const at = Date.parse(s.at);
    const { kind } = iconFor(s);
    nodes.push({
      key: s.id,
      at,
      when: time(at),
      text: describeScan(s),
      meta: [s.stream === "SECURITY" ? "Security gate" : "Time clock", s.device].filter(Boolean).join(" · "),
      kind: s.automatic ? "system" : kind === "meal" ? "meal" : kind === "in" ? "in" : "out",
      note: s.automatic
        ? "Added by the system"
        : s.correctedFrom
          ? `Corrected in the timecard, recorded as ${describeOriginal(s)?.toLowerCase()}`
          : exitOnly.has(s.id)
            ? "No entry scan before it"
            : null,
    });
  }

  const end = isToday ? Math.min(now, dayEnd) : dayEnd;
  const last = nodes.length ? nodes[nodes.length - 1].at : null;
  const openState = last !== null && end - last > 60_000 ? stateAt(v, (last + end) / 2, hasGate) : null;
  if (openState && openState !== "OUTSIDE") {
    nodes.push(
      isToday
        ? {
            key: "now",
            at: end,
            when: "Now",
            text:
              openState === "WORKING"
                ? "Still on the clock"
                : openState === "MEAL" || openState === "BREAK" || openState === "OUT_MEAL"
                  ? `Still on ${openState === "BREAK" ? "break" : "a meal"}`
                  : openState === "OUT_WORKING"
                    ? "Still clocked in, not inside"
                    : "Still inside",
            meta: null,
            kind: "now",
            note: null,
          }
        : { key: "end", at: end, when: "End of day", text: "Never scanned out", meta: null, kind: "end", note: null },
    );
  }

  const links: (StoryLink | null)[] = nodes.slice(1).map((n, i) => {
    const a = nodes[i].at;
    const b = n.at;
    if (b - a < QUIET_MS) return null;
    const state = stateAt(v, (a + b) / 2, hasGate);
    if (!state) return null;
    const minutes = Math.floor((b - a) / 60000);
    return { state, minutes, running: n.kind === "now", worth: linkWorth(state, minutes) };
  });
  return { nodes, links };
}

/**
 * A person's day folded out as one story, top to bottom: every scan is a
 * point, and the line to the next one says what they were doing and for how
 * long, with only what needs a look in amber. Beside it, the day's totals.
 * The day bar in the row above already draws the shape; this reads it out.
 */
function DayStory({
  view: v,
  isToday,
  hasGate,
  tz,
  now,
  dayStart,
  dayEnd,
}: {
  view: PersonDayView;
  isToday: boolean;
  hasGate: boolean;
  tz: string;
  now: number;
  dayStart: number;
  dayEnd: number;
}) {
  const { nodes, links } = buildStory(v, isToday, hasGate, now, dayStart, dayEnd, tz);
  const t = v.lanes.totals;
  const totals: { label: string; minutes: number; worth?: boolean }[] = [
    { label: "Working", minutes: t.workMin },
    ...(hasGate ? [{ label: "Inside the building", minutes: t.insideMin }] : []),
    { label: "Meals and breaks", minutes: t.mealMin + t.breakMin },
    ...(hasGate && !v.person.salaried
      ? [{ label: "Inside, not clocked in", minutes: t.insideOffClockMin, worth: t.insideOffClockMin >= GAP_MIN }]
      : []),
    ...(hasGate ? [{ label: "Clocked in, not inside", minutes: t.workOutsideMin, worth: t.workOutsideMin >= GAP_MIN }] : []),
  ];

  return (
    <div className={styles.dsWrap} onClick={(e) => e.stopPropagation()}>
      <div className={styles.dsCard}>
        <ol className={styles.dsStory}>
          {nodes.length === 0 && <li className={styles.dsEmpty}>No scans that day.</li>}
          {nodes.map((n, i) => {
            const link = i < links.length ? links[i] : null;
            const isLast = i === nodes.length - 1;
            return (
              <li key={n.key} className={styles.dsItem}>
                <span className={styles.dsWhen} data-kind={n.kind}>
                  {n.when}
                </span>
                <span className={styles.dsRail} aria-hidden="true">
                  <span className={styles.dsDot} data-kind={n.kind} />
                  {!isLast && <span className={styles.dsLine} data-state={link?.state} />}
                </span>
                <span className={styles.dsBody}>
                  <span className={styles.dsEvent}>
                    <span className={styles.dsText} data-kind={n.kind}>
                      {n.text}
                    </span>
                    {n.meta && <span className={styles.dsMeta}>{n.meta}</span>}
                  </span>
                  {n.note && <span className={styles.dsNote}>{n.note}</span>}
                  {link && (
                    <span className={styles.dsLink} data-worth={link.worth ? "true" : undefined}>
                      {STATE_LABEL[link.state]}
                      <span className={styles.dsLinkTime}>
                        {fmtDuration(link.minutes)}
                        {link.running ? " so far" : ""}
                      </span>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <aside className={styles.dsTotals} aria-label="Totals">
          <span className={styles.dsTotalsTitle}>Totals</span>
          <dl>
            {totals.map((x) => (
              <div key={x.label} className={styles.dsTotal}>
                <dt>{x.label}</dt>
                <dd data-tone={x.worth ? "warning" : x.minutes === 0 ? "quiet" : undefined}>
                  {x.minutes === 0 ? "None" : fmtDuration(x.minutes)}
                </dd>
              </div>
            ))}
          </dl>
          <span className={styles.dsFoot}>
            {v.scanCount.toLocaleString()} {v.scanCount === 1 ? "scan" : "scans"}
            {v.notCounted > 0 &&
              `. ${v.notCounted.toLocaleString()} more ${v.notCounted === 1 ? "tap was" : "taps were"} not counted, usually a second tap too soon.`}
          </span>
        </aside>
      </div>
    </div>
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

/** The summary panel's shape while it loads, shared by every tab so the page does not jump. */
export function SummarySkeleton({ cards }: { cards: number }) {
  const bar = (w: string | number, h: number) => <span className={styles.skeleton} style={{ width: w, height: h }} />;
  return (
    <div className={styles.summary}>
      <div className={styles.summaryMain} data-cards={cards}>
        <span className={styles.summaryHero} style={{ cursor: "default" }}>
          {bar(110, 14)}
          {bar(96, 44)}
          {bar(140, 12)}
        </span>
        {Array.from({ length: cards }, (_, i) => (
          <span key={i} className={styles.summaryCard} style={{ cursor: "default" }}>
            {bar("70%", 14)}
            {bar(48, 32)}
          </span>
        ))}
      </div>
      <div className={styles.summaryMore}>
        <span className={styles.summaryChips}>
          {[92, 72, 88, 110].map((w) => (
            <span key={w}>{bar(w, 30)}</span>
          ))}
        </span>
        {bar(120, 14)}
      </div>
    </div>
  );
}

export function MovementsSkeleton() {
  const bar = (w: string | number, h: number, r?: number) => (
    <span className={styles.skeleton} style={{ width: w, height: h, borderRadius: r }} />
  );
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading movements">
      <SummarySkeleton cards={3} />
      <div className={styles.group}>
        <div className={styles.mvHead}>
          {[70, 56, 40, 64, 72].map((w, i) => (
            <span key={i}>{bar(w, 10)}</span>
          ))}
          <span />
          <span />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={styles.mvRow} style={{ cursor: "default", borderTop: i ? "1px solid var(--stroke-divider)" : undefined }}>
            <span className={styles.mvWho}>
              {bar(48, 52, 8)}
              <span className="flex flex-1 flex-col gap-1.5">
                {bar("80%", 14)}
                {bar("55%", 12)}
                {bar(64, 16)}
              </span>
            </span>
            <span className="flex flex-col gap-1.5">
              {bar(60, 14)}
              {bar(70, 10)}
            </span>
            <span className="flex flex-col gap-1.5">
              {bar(60, 14)}
              {bar(70, 10)}
            </span>
            <span className="flex justify-end">{bar(64, 14)}</span>
            <span className="flex justify-end">{bar(64, 14)}</span>
            <span className={styles.mvDay}>{bar("100%", 18)}</span>
            <span />
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
    label: "Clocked in, not inside",
    hint: "On the clock while the security gate has them outside. On a past day, 15 minutes or more of it",
    tone: "warning",
  },
  SCHEDULED_OUTSIDE: {
    label: "Scheduled, not here",
    hint: "Inside their scheduled hours right now and not in the building",
    tone: "warning",
  },
  ON_BREAK: { label: "On a break", hint: "Clocked out for a meal or a rest break right now", tone: "warning" },
  NOT_ARRIVED: { label: "Not arrived", hint: "Scheduled and not seen at either reader", tone: "neutral" },
  LATE: { label: "Late", hint: "First scan more than 5 minutes after the scheduled start", tone: "warning" },
  LEFT_EARLY: { label: "Left early", hint: "Last scan out more than 5 minutes before the scheduled end", tone: "warning" },
  MULTIPLE_EXITS: { label: "Left more than once", hint: "Left through the security gate two or more times", tone: "warning" },
  LONG_BREAK: { label: "Long break", hint: `A meal or break that ran past ${LONG_BREAK_MIN} minutes`, tone: "warning" },
  EXIT_NO_ENTRY: { label: "Left, never scanned in", hint: "Left through the security gate without being seen coming in", tone: "error" },
  MARKED_OUT: { label: "Never scanned out", hint: "Never scanned out, so the system closed their day", tone: "neutral" },
  REJECTED: {
    label: "Taps not counted",
    hint: "Had scans the timecard refused, usually a second tap too soon. They are left out of the lists and totals",
    tone: "neutral",
  },
  INACTIVE: { label: "Inactive employee", hint: "Scanning on a record that is inactive or terminated", tone: "error" },
  ON_LEAVE: { label: "On leave", hint: "Approved time off that day", tone: "info" },
  HERE_NOW: { label: "In the building", hint: "Through the security gate and not out again", tone: "info" },
  SEEN: { label: "People seen", hint: "Scanned at either reader that day", tone: "neutral" },
  ON_CLOCK_NOW: { label: "On the clock", hint: "Clocked in and working right now", tone: "info" },
};

/** A filter's name where it depends on the site: without a gate, "here" means on the clock. */
export function flagLabel(f: MovementFlag, hasGate: boolean): string {
  return f === "HERE_NOW" && !hasGate ? "On the clock" : FLAG_META[f].label;
}

/** The filter behind the headline number: here now today, seen on a past day. */
export function heroFlagFor(isToday: boolean): MovementFlag {
  return isToday ? "HERE_NOW" : "SEEN";
}

/** Filters that describe where somebody is, not something to look into. */
const NOT_A_CONCERN: MovementFlag[] = ["ON_LEAVE", "HERE_NOW", "SEEN", "ON_CLOCK_NOW"];

/** Filters other pages open Movements on, which it accepts whatever the day offers. */
export function isViewFlag(f: MovementFlag, isToday: boolean): boolean {
  return f === heroFlagFor(isToday) || (isToday && f === "ON_CLOCK_NOW");
}

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
 * The summary above the table, in two tiers so it reads in one glance.
 *
 * <p>The first tier answers the questions the page is opened for: how many
 * people are here, and the few situations somebody has to act on (inside and
 * not clocked in, clocked in and not inside, scheduled and not here). Those
 * stay on screen at zero, because zero is the answer.
 *
 * <p>The second tier is everything else worth a look that day, as small
 * chips, and only the ones that happened: a row of zeros is noise to somebody
 * scanning for a problem. Every number is also the filter for it.
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
  /** Opens the Scan log. */
  onJump: (c: LogCounter | null) => void;
}) {
  const available = flagsFor(isToday, hasGate);
  const lead = (isToday ? NOW_FLAGS : PAST_FLAGS).filter((f) => available.includes(f) && f !== "ON_BREAK");
  const cards = (hasGate ? lead.filter((f) => f !== "NOT_ARRIVED") : lead).slice(0, 3);
  const chips = available.filter((f) => !cards.includes(f) && (counts[f] > 0 || flag === f));
  const insideNow = views.filter((v) => (hasGate ? v.now.inside : v.now.clock !== "OUT")).length;
  const seen = views.filter((v) => v.scanCount > 0).length;
  const pick = (f: MovementFlag) => onPick(flag === f ? null : f);
  const heroFlag = heroFlagFor(isToday);

  const heroLabel = isToday ? (hasGate ? "In the building" : "On the clock") : "People seen";
  const heroFigure = isToday ? insideNow : seen;
  const heroSub = isToday
    ? `of ${views.length.toLocaleString()} ${views.length === 1 ? "person" : "people"} today`
    : when;

  return (
    <section className={styles.summary} aria-label="Summary">
      <div className={styles.summaryMain} data-cards={cards.length}>
        <button
          type="button"
          className={styles.summaryHero}
          aria-pressed={flag === heroFlag}
          onClick={() => pick(heroFlag)}
          title={flag === heroFlag ? "Show everyone" : `Show only these ${heroFigure.toLocaleString()}`}
        >
          <span className={styles.summaryLabel}>{heroLabel}</span>
          <span className={styles.summaryHeroFigure}>{heroFigure.toLocaleString()}</span>
          <span className={styles.summarySub}>{heroSub}</span>
        </button>
        {cards.map((f) => (
          <button
            key={f}
            type="button"
            className={styles.summaryCard}
            aria-pressed={flag === f}
            data-empty={counts[f] === 0 ? "true" : undefined}
            onClick={() => pick(f)}
            title={FLAG_META[f].hint}
          >
            <span className={styles.summaryLabel}>
              <span className={styles.dot} style={{ background: TONE_COLOR[FLAG_META[f].tone] }} aria-hidden="true" />
              <span className="truncate">{FLAG_META[f].label}</span>
            </span>
            <span className={styles.summaryFigure}>{counts[f].toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className={styles.summaryMore}>
        {chips.length > 0 ? (
          <div className={styles.summaryChips}>
            {chips.map((f) => (
              <button
                key={f}
                type="button"
                className={styles.summaryChip}
                aria-pressed={flag === f}
                onClick={() => pick(f)}
                title={FLAG_META[f].hint}
              >
                <span className={styles.dot} style={{ background: TONE_COLOR[FLAG_META[f].tone] }} aria-hidden="true" />
                <span>{FLAG_META[f].label}</span>
                <span className={styles.summaryChipCount}>{counts[f].toLocaleString()}</span>
              </button>
            ))}
          </div>
        ) : (
          <span style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>Nothing else to review {when}</span>
        )}
        <button type="button" className={styles.summaryScans} onClick={() => onJump(null)} title="Open the Scan log">
          <span className="tabular" style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
            {totals.all.toLocaleString()}
          </span>
          <span>
            {totals.all === 1 ? "scan" : "scans"} {when}
          </span>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

/* ── Sorting ────────────────────────────────────────────────────────────── */

export type MvSort = "name" | "department" | "arrival" | "latest" | "inside" | "flags";

export const MV_SORTS: { key: MvSort; label: string }[] = [
  { key: "latest", label: "Latest activity" },
  { key: "name", label: "Name" },
  { key: "department", label: "Department" },
  { key: "arrival", label: "Arrival time" },
  { key: "inside", label: "Time inside" },
  { key: "flags", label: "Most flags" },
];

/**
 * Who moved last comes first: the page is opened to see what is happening,
 * and a name order puts the one person who just walked out anywhere.
 */
export const MV_DEFAULT_SORT: MvSort = "latest";

/** The orders a refresh can change, which the list holds still until asked. */
export const MV_SORTS_THAT_MOVE: MvSort[] = ["latest", "arrival", "inside", "flags"];

export function parseMvSort(raw: string | null | undefined): MvSort {
  return MV_SORTS.some((s) => s.key === raw) ? (raw as MvSort) : MV_DEFAULT_SORT;
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
      return (a, b) =>
        b.flags.filter((f) => !NOT_A_CONCERN.includes(f)).length - a.flags.filter((f) => !NOT_A_CONCERN.includes(f)).length ||
        name(a, b);
    default:
      return name;
  }
}
