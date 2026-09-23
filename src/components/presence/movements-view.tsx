"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, DoorOpen, UserRoundX } from "lucide-react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { getOnSiteMovements } from "@/actions/presence.actions";
import type { PresenceStatus, SiteDay } from "@/lib/presence/types";
import {
  LONG_BREAK_MIN,
  type MovementFlag,
  type MovementLine,
  type PersonDayView,
} from "@/lib/presence/movements";
import { STATUS_META, fmtDuration, fmtShift, fmtTime, initialsOf } from "./presence-meta";
import styles from "./on-site.module.css";

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
  if (has("REJECTED")) out.push({ label: `${v.rejected} not accepted`, tone: "neutral" });
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
}: {
  views: PersonDayView[];
  data: SiteDay;
  now: number;
  stickyTop: number;
  shown: number;
  onShowMore: () => void;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const isToday = data.day === data.today;
  const tz = data.site.timezone;
  return (
    <section className={styles.group} aria-label="Movements">
      <div className={styles.mvHead} style={{ top: stickyTop }} aria-hidden="true">
        <span>Employee</span>
        <span className={styles.mvHeadLines}>
          <span>Reader</span>
          <span>Activity</span>
          <span>From</span>
          <span>To</span>
          <span className={styles.mvNum}>Duration</span>
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
}: {
  view: PersonDayView;
  isToday: boolean;
  hasGate: boolean;
  tz: string;
  now: number;
  selected: boolean;
  onOpen: () => void;
}) {
  const p = v.person;
  const status = statusOfDay(v, isToday, hasGate);
  const meta = status ? STATUS_META[status] : null;
  const chips = flagChips(v, isToday);
  const schedule = fmtShift(p.scheduledStart, p.scheduledEnd);
  const t = v.lanes.totals;

  return (
    <li>
      <button
        type="button"
        className={styles.mvPerson}
        aria-pressed={selected}
        onClick={onOpen}
        title={`${p.name} · ${p.employeeCode}`}
      >
        <span className={styles.mvWho}>
          <span className={styles.mvPhoto}>
            <span className={styles.initials} aria-hidden="true">
              {initialsOf(p.name)}
            </span>
            {p.photoUrl && <img src={p.photoUrl} alt="" loading="lazy" decoding="async" />}
            {meta && <span className={styles.stripe} style={{ background: meta.color, height: 4 }} />}
          </span>
          <span className={styles.mvIdentity}>
            <span className={styles.mvName}>{p.name}</span>
            <span className={styles.meta}>
              {p.employeeCode}
              {p.department ? ` · ${p.department}` : ""}
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
        </span>
      </button>
    </li>
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
    <div className={styles.group} aria-busy="true" aria-label="Loading movements">
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
  );
}
