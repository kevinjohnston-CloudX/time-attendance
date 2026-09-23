"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Clock, Coffee, DoorClosed, DoorOpen, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { getOnSitePerson } from "@/actions/presence.actions";
import { addDays, dayLabel, DAYS_BACK } from "@/lib/presence/days";
import { buildLanes, type DayLanes } from "@/lib/presence/lanes";
import type { PresenceDetail, PresencePerson, PresenceScan } from "@/lib/presence/types";
import { snapToLocalTime } from "@/lib/utils/date";
import {
  STATUS_META,
  describeScan,
  fmtDuration,
  fmtShift,
  fmtTime,
  fmtWhen,
  initialsOf,
  minutesSince,
  statusLabel,
} from "./presence-meta";
import styles from "./on-site.module.css";
import { ZoomableFace } from "./face";

/**
 * One person, opened from the board or the scan log: who they are, and their
 * day at both readers, drawn as two lanes on one clock so the gaps between
 * them show.
 *
 * <p>The day is fetched when the panel opens, again whenever the board
 * refreshes while it shows today, and again when somebody steps to another
 * day. Only one person's day is ever wanted at a time, so it is not carried
 * in the board, which every viewer fetches every 30 seconds.
 *
 * <p>It sits over the page rather than beside it so the faces keep their full
 * width, and closes on Escape, on the scrim, and on the close button.
 */

/** A gap this long between the readers is worth a second look. */
const GAP_WORTH_NOTING_MIN = 15;

export function PersonPanel({
  siteId,
  employeeId,
  person,
  initialDay,
  today,
  hasGateData,
  tz,
  now,
  refreshedAt,
  onClose,
  onZoom,
}: {
  siteId: string;
  employeeId: string;
  /** Their place on the board right now, when they have one. */
  person: PresencePerson | null;
  /** The day to open on; null for today. */
  initialDay: string | null;
  today: string;
  hasGateData: boolean;
  tz: string;
  now: number;
  refreshedAt: string;
  onClose: () => void;
  /** Opens the photo large; the panel stays open behind it. */
  onZoom?: (src: string, who: { name: string; detail: string }) => void;
}) {
  const [day, setDay] = useState(initialDay ?? today);
  const [detail, setDetail] = useState<PresenceDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  // The board re-renders every few seconds with a fresh onClose, and the focus
  // effect below must run once per opening, not once per render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const isToday = day === today;
  // Only today moves, so only today re-reads on every board refresh.
  const refreshKey = isToday ? refreshedAt : "";

  useEffect(() => {
    let live = true;
    getOnSitePerson({ siteId, employeeId, day })
      .then((res) => {
        if (!live) return;
        if (res.success) {
          setDetail(res.data);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [siteId, employeeId, day, refreshKey]);

  // Focus goes into the panel when it opens and back where it came from when
  // it closes, so a keyboard user is never left on a tile behind the scrim.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headRef.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  // The detail on screen belongs to the day picked, or it is still loading.
  const shown = detail && detail.day === day ? detail : null;

  const lanes = useMemo(() => {
    if (!shown) return null;
    const from = Date.parse(shown.dayStart);
    const end = Date.parse(shown.dayEnd);
    return buildLanes({
      scans: shown.scans,
      carryGate: shown.carryGate,
      carryClock: shown.carryClock,
      from,
      to: shown.day === shown.today ? Math.min(now, end) : end,
    });
  }, [shown, now]);

  const name = person?.name ?? detail?.name ?? "";
  const meta = person ? STATUS_META[person.status] : null;
  const mins = person ? minutesSince(person.since, now) : null;
  const schedule = shown ? fmtShift(shown.scheduledStart, shown.scheduledEnd) : undefined;
  const label = dayLabel(day, today);
  const oldest = addDays(today, -DAYS_BACK);

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={name || "Employee"}>
        <div ref={headRef} className={styles.panelHead}>
          <span style={{ font: "var(--type-h4)", color: "var(--text-primary)" }}>Employee</span>
          <Button hierarchy="tertiary" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className={styles.panelBody}>
          <div className={styles.identity}>
            <span className={styles.portrait}>
              <span className={styles.initials} style={{ fontSize: 36 }} aria-hidden="true">
                {name ? initialsOf(name) : ""}
              </span>
              <ZoomableFace
                src={person?.photoUrl ?? detail?.photoUrl}
                name={name}
                onZoom={
                  onZoom &&
                  ((src) =>
                    onZoom(src, {
                      name,
                      detail: [person?.employeeCode ?? detail?.employeeCode, person?.department ?? detail?.department]
                        .filter(Boolean)
                        .join(" · "),
                    }))
                }
              />
              {meta && isToday && <span className={styles.stripe} style={{ background: meta.color, height: 6 }} />}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5 pt-1">
              {name ? (
                <h2 className="truncate" style={{ margin: 0, font: "var(--type-h3)", color: "var(--text-primary)" }} title={name}>
                  {name}
                </h2>
              ) : (
                <span className={styles.skeleton} style={{ width: 180, height: 24 }} />
              )}
              <span className="line-clamp-2" style={{ font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                {detail?.jobTitle ?? person?.department ?? detail?.department ?? ""}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                {/* The live status says where they are now, so it only sits
                    beside today. On another day the lanes say it instead. */}
                {person && meta && isToday && (
                  <Badge tone={meta.badge} dot>
                    {statusLabel(person)}
                  </Badge>
                )}
                {person && isToday && person.status === "NO_GATE_SCAN" && <Badge tone="warning">No gate scan</Badge>}
                {person && isToday && person.outsideOnMeal && <Badge tone="neutral">Outside the building</Badge>}
                {(person?.inactive || detail?.inactive) && <Badge tone="error">Inactive record</Badge>}
              </span>
              {person && isToday && (
                <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  {statusSentence(person, tz, mins, new Date(now).toISOString())}
                </span>
              )}
            </div>
          </div>

          <div className={styles.facts}>
            <Fact label="Employee code" value={person?.employeeCode ?? detail?.employeeCode} />
            <Fact label="Department" value={person ? person.department : detail ? detail.department : undefined} />
            <Fact label="Shift" value={detail ? detail.shift : person ? person.shift : undefined} />
            <Fact label="Supervisor" value={detail ? detail.supervisor ?? "None assigned" : undefined} />
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>Attendance</h3>
              <div className={styles.dayPick} role="group" aria-label="Day">
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  iconOnly
                  aria-label="Previous day"
                  disabled={day <= oldest}
                  onClick={() => setDay((d) => addDays(d, -1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className={styles.dayPickLabel} aria-live="polite">
                  {label}
                </span>
                <Button
                  hierarchy="tertiary"
                  size="sm"
                  iconOnly
                  aria-label="Next day"
                  disabled={isToday}
                  onClick={() => setDay((d) => addDays(d, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {failed && !shown ? (
              <p style={{ margin: 0, font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                This day could not be loaded. It will be tried again on the next refresh.
              </p>
            ) : !shown || !lanes ? (
              <LanesSkeleton />
            ) : (
              <>
                <Lanes
                  lanes={lanes}
                  detail={shown}
                  hasGateData={hasGateData}
                  tz={tz}
                  now={now}
                />
                <div className={styles.facts}>
                  <Fact label={isToday ? "Scheduled today" : "Scheduled"} value={schedule ?? "Not scheduled"} />
                  <Fact
                    label="First in, last out"
                    value={
                      lanes.firstIn
                        ? `${fmtTime(new Date(lanes.firstIn).toISOString(), tz)}${
                            lanes.lastOut && lanes.lastOut > lanes.firstIn
                              ? ` to ${fmtTime(new Date(lanes.lastOut).toISOString(), tz)}`
                              : ""
                          }`
                        : "Not seen"
                    }
                  />
                  {hasGateData && <Total label="Inside the building" minutes={lanes.totals.insideMin} />}
                  <Total label="On the clock" minutes={lanes.totals.workMin} />
                  <Total label="Meals and breaks" minutes={lanes.totals.mealMin + lanes.totals.breakMin} />
                  {hasGateData && (
                    <Total
                      label="Inside, off the clock"
                      minutes={lanes.totals.insideOffClockMin}
                      hint="In the building, not clocked in, and not on a meal or break"
                      flag
                    />
                  )}
                  {hasGateData && (
                    <Total
                      label="On the clock, outside"
                      minutes={lanes.totals.workOutsideMin}
                      hint="Clocked in while the security gate had them outside the building"
                      flag
                    />
                  )}
                </div>
              </>
            )}
          </section>

          <section className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3 style={{ margin: 0, font: "var(--type-h4)", color: "var(--text-primary)" }}>Scans</h3>
              {shown && (
                <span className="tabular" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                  {shown.scans.length.toLocaleString()} {shown.scans.length === 1 ? "scan" : "scans"}
                </span>
              )}
            </div>
            {failed && !shown ? null : !shown ? (
              <TimelineSkeleton />
            ) : shown.scans.length === 0 ? (
              <p style={{ margin: "8px 0 0", font: "var(--type-body1)", color: "var(--text-secondary)" }}>
                {isToday ? "No reader has seen this person today." : "No reader saw this person that day."}
              </p>
            ) : (
              <Timeline scans={shown.scans} tz={tz} />
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

function statusSentence(p: PresencePerson, tz: string, mins: number | null, nowIso: string): string {
  const at = fmtWhen(p.since, tz, nowIso);
  const forHow = mins !== null && mins >= 1 ? ` (${fmtDuration(mins)})` : "";
  switch (p.status) {
    case "WORKING":
      return at ? `On the clock since ${at}${forHow}` : "On the clock";
    case "NO_GATE_SCAN":
      return at ? `Clocked in since ${at}${forHow}, no gate entry` : "On the clock, no gate entry";
    case "ON_MEAL":
      return at ? `Started ${p.breakKind === "BREAK" ? "a break" : "a meal"} at ${at}${forHow}` : statusLabel(p);
    case "OFF_CLOCK":
      return at ? `Inside since ${at}${forHow}, not clocked in` : "Inside, not clocked in";
    case "LEFT":
      return at ? `Left at ${at}` : "Left";
    case "NOT_ARRIVED":
      return p.lateMinutes !== null ? `${fmtDuration(p.lateMinutes)} past the scheduled start` : "Not due yet";
    case "ON_LEAVE":
      return "Approved time off today";
  }
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      {value === undefined ? (
        <span className={styles.skeleton} style={{ width: "60%", height: 14, marginTop: 3 }} />
      ) : (
        <span className={styles.factValue} title={value ?? undefined}>
          {value ?? "None"}
        </span>
      )}
    </div>
  );
}

/** A duration in the facts grid. A gap between the readers long enough to matter reads amber. */
function Total({ label, minutes, hint, flag }: { label: string; minutes: number; hint?: string; flag?: boolean }) {
  const noted = flag && minutes >= GAP_WORTH_NOTING_MIN;
  return (
    <div className={styles.fact} title={hint}>
      <span className={styles.factLabel}>{label}</span>
      <span
        className={`${styles.factValue} tabular`}
        style={noted ? { color: "var(--text-warning)" } : minutes === 0 ? { color: "var(--text-tertiary)" } : undefined}
      >
        {minutes === 0 ? "None" : fmtDuration(minutes)}
      </span>
    </div>
  );
}

/* ── The two lanes ──────────────────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;
const hourLabel = new Map<string, Intl.DateTimeFormat>();

function fmtHour(ms: number, timeZone: string): string {
  let f = hourLabel.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: true });
    hourLabel.set(timeZone, f);
  }
  return f.format(new Date(ms));
}

/**
 * Schedule, security gate and time clock on one clock, one lane each. The
 * clock spans the part of the day anything happened in, in whole hours, and
 * never less than eight, so a short day still reads as a day.
 */
function Lanes({
  lanes,
  detail,
  hasGateData,
  tz,
  now,
}: {
  lanes: DayLanes;
  detail: PresenceDetail;
  hasGateData: boolean;
  tz: string;
  now: number;
}) {
  const dayStart = Date.parse(detail.dayStart);
  const dayEnd = Date.parse(detail.dayEnd);
  const isToday = detail.day === detail.today;

  const sched =
    detail.scheduledStart && detail.scheduledEnd
      ? (() => {
          const s = snapToLocalTime(detail.scheduledStart, detail.day, tz).getTime();
          let e = snapToLocalTime(detail.scheduledEnd, detail.day, tz).getTime();
          if (e <= s) e = Math.min(e + 24 * HOUR, dayEnd); // An overnight shift runs to the end of the day.
          return { start: s, end: Math.min(e, dayEnd) };
        })()
      : null;

  const points = [
    ...lanes.gate.flatMap((g) => [g.start, g.end]),
    ...lanes.clock.flatMap((c) => [c.start, c.end]),
    ...detail.scans.map((s) => Date.parse(s.at)),
    ...(sched ? [sched.start, sched.end] : []),
  ];
  let from = points.length ? Math.floor(Math.min(...points) / HOUR) * HOUR : dayStart + 6 * HOUR;
  let to = points.length ? Math.ceil(Math.max(...points) / HOUR) * HOUR : dayStart + 18 * HOUR;
  if (to - from < 8 * HOUR) {
    to = Math.min(from + 8 * HOUR, dayEnd);
    from = Math.max(to - 8 * HOUR, dayStart);
  }
  from = Math.max(from, dayStart);
  to = Math.min(to, dayEnd);
  const span = Math.max(to - from, HOUR);
  const pct = (t: number) => `${(((Math.min(Math.max(t, from), to) - from) / span) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) =>
    `${(((Math.min(b, to) - Math.max(a, from)) / span) * 100).toFixed(3)}%`;

  const step = span <= 10 * HOUR ? 2 * HOUR : span <= 16 * HOUR ? 3 * HOUR : 4 * HOUR;
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);

  const time = (ms: number) => fmtTime(new Date(ms).toISOString(), tz);
  const until = (s: { end: number; open: boolean }) =>
    s.open ? (isToday ? "now" : "the end of the day, no scan out") : time(s.end);
  const nowAt = isToday && now > from && now < to ? pct(now) : null;

  return (
    <div className={styles.lanes}>
      <div className={styles.laneRow}>
        <span className={styles.laneName}>Scheduled</span>
        <span className={styles.laneTrack} data-quiet="true">
          {sched ? (
            <span
              className={styles.laneSched}
              style={{ left: pct(sched.start), width: width(sched.start, sched.end) }}
              title={`Scheduled ${time(sched.start)} to ${time(sched.end)}`}
            />
          ) : (
            <span className={styles.laneEmpty}>Not scheduled</span>
          )}
          {nowAt && <span className={styles.laneNow} style={{ left: nowAt }} aria-hidden="true" />}
        </span>
      </div>

      <div className={styles.laneRow}>
        <span className={styles.laneName}>Security gate</span>
        <span className={styles.laneTrack}>
          {!hasGateData ? (
            <span className={styles.laneEmpty}>Not reporting at this site</span>
          ) : lanes.gate.length === 0 ? (
            <span className={styles.laneEmpty}>Not inside</span>
          ) : (
            lanes.gate.map((g) => (
              <span
                key={g.start}
                className={styles.laneSeg}
                data-kind="inside"
                data-open={g.open && !isToday ? "true" : undefined}
                style={{ left: pct(g.start), width: width(g.start, g.end) }}
                title={`Inside ${time(g.start)} to ${until(g)} (${fmtDuration((g.end - g.start) / 60000)})${
                  g.closedBySystem ? ". Closed by the system, no scan out" : ""
                }`}
              />
            ))
          )}
          {nowAt && <span className={styles.laneNow} style={{ left: nowAt }} aria-hidden="true" />}
        </span>
      </div>

      <div className={styles.laneRow}>
        <span className={styles.laneName}>Time clock</span>
        <span className={styles.laneTrack}>
          {lanes.clock.length === 0 ? (
            <span className={styles.laneEmpty}>Not clocked in</span>
          ) : (
            lanes.clock.map((c) => (
              <span
                key={c.start}
                className={styles.laneSeg}
                data-kind={c.kind === "WORK" ? "work" : "meal"}
                data-open={c.open && !isToday ? "true" : undefined}
                style={{ left: pct(c.start), width: width(c.start, c.end) }}
                title={`${c.kind === "WORK" ? "On the clock" : c.kind === "MEAL" ? "Meal" : "Break"} ${time(c.start)} to ${until(c)} (${fmtDuration(
                  (c.end - c.start) / 60000,
                )})${c.closedBySystem ? ". Clocked out by the system" : ""}`}
              />
            ))
          )}
          {nowAt && <span className={styles.laneNow} style={{ left: nowAt }} aria-hidden="true" />}
        </span>
      </div>

      <div className={styles.laneAxis} aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {fmtHour(t, tz)}
          </span>
        ))}
      </div>

      <div className={styles.laneKey}>
        {hasGateData && (
          <span>
            <i data-kind="inside" /> Inside
          </span>
        )}
        <span>
          <i data-kind="work" /> On the clock
        </span>
        <span>
          <i data-kind="meal" /> Meal or break
        </span>
        <span>
          <i data-kind="sched" /> Scheduled
        </span>
      </div>
    </div>
  );
}

function LanesSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className="flex items-center gap-3">
          <span className={styles.skeleton} style={{ width: 84, height: 12 }} />
          <span className={styles.skeleton} style={{ flex: 1, height: 20 }} />
        </span>
      ))}
    </div>
  );
}

/* ── The scans, one by one ──────────────────────────────────────────────── */

function Timeline({ scans, tz }: { scans: PresenceScan[]; tz: string }) {
  return (
    <ol className={styles.timeline}>
      {scans.map((s) => {
        const { icon, kind } = iconFor(s);
        const notes = [
          s.stream === "SECURITY" ? "Security gate" : "Time clock",
          s.device,
          s.reread ? "Read twice by the reader" : null,
          s.rejected ? "Not accepted by the timecard" : null,
          s.automatic ? "Added by the system" : null,
        ].filter(Boolean);
        return (
          <li key={s.id} className={styles.event}>
            <span className={styles.eventTime}>{fmtTime(s.at, tz)}</span>
            <span className={styles.eventIcon} data-kind={s.rejected ? "error" : kind} aria-hidden="true">
              {icon}
            </span>
            <span className={styles.eventText}>
              <span style={{ font: "var(--weight-medium) 14px/20px var(--font-sans)", color: "var(--text-primary)" }}>
                {describeScan(s)}
              </span>
              <span className="truncate" style={{ font: "var(--type-body2)", color: "var(--text-tertiary)" }}>
                {notes.join(" · ")}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function iconFor(s: PresenceScan): { icon: ReactNode; kind: "in" | "out" | "meal" | "error" } {
  const cls = "h-3.5 w-3.5";
  if (s.stream === "SECURITY") {
    return s.direction === "IN"
      ? { icon: <DoorOpen className={cls} />, kind: "in" }
      : { icon: <DoorClosed className={cls} />, kind: "out" };
  }
  if (s.punchType === "MEAL_START" || s.punchType === "BREAK_START") return { icon: <Coffee className={cls} />, kind: "meal" };
  if (s.punchType === "MEAL_END" || s.punchType === "BREAK_END") return { icon: <Clock className={cls} />, kind: "in" };
  // The words say what the timecard made of the scan, so the icon does too.
  if (s.punchType === "CLOCK_IN") return { icon: <Clock className={cls} />, kind: "in" };
  if (s.punchType === "CLOCK_OUT") return { icon: <Clock className={cls} />, kind: "out" };
  return { icon: <Clock className={cls} />, kind: s.direction === "IN" ? "in" : "out" };
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-3 pt-3" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="flex items-center gap-3">
          <span className={styles.skeleton} style={{ width: 64, height: 14 }} />
          <span className={styles.skeleton} style={{ width: 28, height: 28, borderRadius: 999 }} />
          <span className={styles.skeleton} style={{ width: "50%", height: 14 }} />
        </span>
      ))}
    </div>
  );
}
