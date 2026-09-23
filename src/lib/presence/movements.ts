import { snapToLocalTime } from "@/lib/utils/date";
import { buildLanes, type DayLanes } from "./lanes";
import type { DayPerson, PresenceScan, SiteDay } from "./types";

/**
 * One person's day as lines in a table, and what about it is worth a look.
 *
 * <p>Each line is one stretch from one reader: a trip inside the building
 * from the security gate, or a stretch on the clock, on a meal or on a break
 * from the time clock. Somebody who went out twice has two gate lines; a
 * meal is its own line between two working lines. Lines run in the order they
 * started.
 *
 * <p>Pure and free of the database. The browser runs it for every person on
 * each tick of its clock, so an open line and the flags that depend on the
 * time ("scheduled now but outside", "late") stay current between refreshes.
 */

/** Minutes past a scheduled start or before a scheduled end before it counts. */
export const LATE_GRACE_MIN = 5;
/** A meal or break longer than this is flagged. */
export const LONG_BREAK_MIN = 60;
/** A gap between the readers on a finished day, long enough to flag. */
export const GAP_MIN = 15;

export type MovementKind = "INSIDE" | "WORK" | "MEAL" | "BREAK" | "EXIT_ONLY";

export interface MovementLine {
  key: string;
  reader: "gate" | "clock";
  kind: MovementKind;
  /** Null when it began before the day (carried) or, for EXIT_ONLY, never had a start. */
  start: number | null;
  /** Null while it is still going. */
  end: number | null;
  minutes: number;
  carried: boolean;
  closedBySystem: boolean;
  startDevice: string | null;
  endDevice: string | null;
}

export type MovementFlag =
  | "INSIDE_OFF_CLOCK"
  | "NO_GATE_SCAN"
  | "SCHEDULED_OUTSIDE"
  | "NOT_ARRIVED"
  | "LATE"
  | "LEFT_EARLY"
  | "ON_BREAK"
  | "LONG_BREAK"
  | "MULTIPLE_EXITS"
  | "EXIT_NO_ENTRY"
  | "MARKED_OUT"
  | "REJECTED"
  | "INACTIVE"
  | "ON_LEAVE";

export const FLAG_ORDER: MovementFlag[] = [
  "INSIDE_OFF_CLOCK",
  "NO_GATE_SCAN",
  "SCHEDULED_OUTSIDE",
  "NOT_ARRIVED",
  "LATE",
  "LEFT_EARLY",
  "ON_BREAK",
  "LONG_BREAK",
  "MULTIPLE_EXITS",
  "EXIT_NO_ENTRY",
  "MARKED_OUT",
  "REJECTED",
  "INACTIVE",
  "ON_LEAVE",
];

/** Where somebody is at the end of what the day has recorded: now, for today. */
export interface NowState {
  inside: boolean;
  clock: "WORK" | "MEAL" | "BREAK" | "OUT";
}

export interface PersonDayView {
  person: DayPerson;
  lanes: DayLanes;
  lines: MovementLine[];
  flags: MovementFlag[];
  now: NowState;
  /** Scheduled start and end as instants, when there is a schedule. */
  schedule: { start: number; end: number } | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
  exits: number;
  rejected: number;
  scanCount: number;
  firstIn: number | null;
  lastOut: number | null;
  /** When anything last happened, for sorting by latest activity. */
  lastActivity: number | null;
}

export function buildPersonDay(
  person: DayPerson,
  day: SiteDay,
  now: number,
): PersonDayView {
  const scans: PresenceScan[] = day.scans[person.id] ?? [];
  const carry = day.carry[person.id] ?? { gate: null, clock: null };
  const from = Date.parse(day.dayStart);
  const dayEnd = Date.parse(day.dayEnd);
  const isToday = day.day === day.today;
  const to = isToday ? Math.min(now, dayEnd) : dayEnd;
  const hasGate = day.site.hasGateData;

  const lanes = buildLanes({ scans, carryGate: carry.gate, carryClock: carry.clock, from, to });

  const lines: MovementLine[] = [];
  for (const g of lanes.gate) {
    lines.push({
      key: `g${g.start}`,
      reader: "gate",
      kind: "INSIDE",
      start: g.startScan ? g.start : null,
      end: g.open ? null : g.end,
      minutes: Math.floor((g.end - g.start) / 60000),
      carried: !g.startScan,
      closedBySystem: g.closedBySystem,
      startDevice: g.startScan?.device ?? null,
      endDevice: g.endScan?.device ?? null,
    });
  }
  for (const s of lanes.exitsWithoutEntry) {
    const t = Date.parse(s.at);
    lines.push({
      key: `x${s.id}`,
      reader: "gate",
      kind: "EXIT_ONLY",
      start: null,
      end: t,
      minutes: 0,
      carried: false,
      closedBySystem: false,
      startDevice: null,
      endDevice: s.device,
    });
  }
  for (const c of lanes.clock) {
    lines.push({
      key: `c${c.start}`,
      reader: "clock",
      kind: c.kind,
      start: c.startScan ? c.start : null,
      end: c.open ? null : c.end,
      minutes: Math.floor((c.end - c.start) / 60000),
      carried: !c.startScan,
      closedBySystem: c.closedBySystem,
      startDevice: c.startScan?.device ?? null,
      endDevice: c.endScan?.device ?? null,
    });
  }
  // In the order they started; a stretch carried from last night comes first.
  const startOf = (l: MovementLine) => l.start ?? (l.kind === "EXIT_ONLY" ? l.end ?? from : from);
  lines.sort((a, b) => startOf(a) - startOf(b) || (a.reader === "gate" ? -1 : 1));

  // Where the day leaves them. Only an open stretch counts: a finished day
  // ends with everybody outside unless nobody ever scanned them out.
  const openGate = lanes.gate.find((g) => g.open);
  const openClock = lanes.clock.find((c) => c.open);
  const nowState: NowState = { inside: !!openGate, clock: openClock ? openClock.kind : "OUT" };

  const schedule =
    person.scheduledStart && person.scheduledEnd
      ? (() => {
          const start = snapToLocalTime(person.scheduledStart, day.day, day.site.timezone).getTime();
          let end = snapToLocalTime(person.scheduledEnd, day.day, day.site.timezone).getTime();
          if (end <= start) end += 24 * 60 * 60 * 1000; // An overnight shift ends tomorrow.
          return { start, end };
        })()
      : null;

  const firstIn = lanes.firstIn;
  const lastOut = lanes.lastOut;
  const present = nowState.inside || nowState.clock !== "OUT";
  const grace = LATE_GRACE_MIN * 60000;

  const lateMinutes =
    schedule && firstIn && firstIn > schedule.start + grace ? Math.floor((firstIn - schedule.start) / 60000) : null;
  const earlyMinutes =
    schedule && lastOut && !present && lastOut < schedule.end - grace && lastOut > schedule.start
      ? Math.floor((schedule.end - lastOut) / 60000)
      : null;

  // Trips out, not raw exit reads: a stretch inside that a scan closed, plus
  // any exit with no entry before it. A double read at the turnstile is one.
  const exits = hasGate
    ? lanes.gate.filter((g) => !g.open && !g.closedBySystem).length + lanes.exitsWithoutEntry.length
    : lanes.clock.filter((c) => c.kind === "WORK" && c.endScan?.punchType === "CLOCK_OUT").length;
  const rejected = scans.filter((s) => s.rejected).length;
  const breaks = lanes.clock.filter((c) => c.kind !== "WORK");

  const flags: MovementFlag[] = [];
  const add = (f: MovementFlag, when: boolean) => when && flags.push(f);

  add(
    "INSIDE_OFF_CLOCK",
    hasGate && (isToday ? nowState.inside && nowState.clock === "OUT" : lanes.totals.insideOffClockMin >= GAP_MIN),
  );
  add(
    "NO_GATE_SCAN",
    hasGate && (isToday ? nowState.clock === "WORK" && !nowState.inside : lanes.totals.workOutsideMin >= GAP_MIN),
  );
  add(
    "SCHEDULED_OUTSIDE",
    isToday &&
      !!schedule &&
      !person.onLeave &&
      now >= schedule.start &&
      now < schedule.end &&
      !(hasGate ? nowState.inside : nowState.clock !== "OUT"),
  );
  add(
    "NOT_ARRIVED",
    !!schedule && !person.onLeave && firstIn === null && !present && (!isToday || now > schedule.start + grace),
  );
  add("LATE", lateMinutes !== null);
  add("LEFT_EARLY", earlyMinutes !== null);
  add("ON_BREAK", isToday && (nowState.clock === "MEAL" || nowState.clock === "BREAK"));
  add("LONG_BREAK", breaks.some((b) => (b.end - b.start) / 60000 > LONG_BREAK_MIN));
  add("MULTIPLE_EXITS", exits >= 2);
  add("EXIT_NO_ENTRY", lanes.exitsWithoutEntry.length > 0);
  add("MARKED_OUT", scans.some((s) => s.automatic && s.direction === "OUT"));
  add("REJECTED", rejected > 0);
  add("INACTIVE", person.inactive && scans.length > 0);
  add("ON_LEAVE", person.onLeave);

  const last = scans.length ? Date.parse(scans[scans.length - 1].at) : null;

  return {
    person,
    lanes,
    lines,
    flags,
    now: nowState,
    schedule,
    lateMinutes,
    earlyMinutes,
    exits,
    rejected,
    scanCount: scans.length,
    firstIn,
    lastOut,
    lastActivity: last,
  };
}

export function buildSiteDay(day: SiteDay, now: number): PersonDayView[] {
  return day.people.map((p) => buildPersonDay(p, day, now));
}

export function countFlags(views: PersonDayView[]): Record<MovementFlag, number> {
  const c = Object.fromEntries(FLAG_ORDER.map((f) => [f, 0])) as Record<MovementFlag, number>;
  for (const v of views) for (const f of v.flags) c[f] += 1;
  return c;
}
