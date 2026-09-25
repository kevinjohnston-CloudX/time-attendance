import type { PresenceScan } from "./types";

/**
 * One person's day at the two readers, as stretches of time.
 *
 * <p>The gate lane is when they were inside the building. The time clock lane
 * is when they were on the clock, on a meal or on a break. Both are rebuilt
 * from the scans alone, in order, starting from whatever state the last scan
 * before the day left them in, so somebody who came in at 10 PM yesterday is
 * already inside at midnight.
 *
 * <p>The time clock lane is the person's, at every building: a day that began
 * at one warehouse and ended at another is one shift. The gate lane is this
 * building's alone. Another building's gate only makes the `away` lane, which
 * is never drawn: it says they were inside somewhere else, so being on the
 * clock and outside this building is not a missed gate scan.
 *
 * <p>Pure, and free of the database, so the panel can redraw an open stretch
 * up to "now" between refreshes without asking the server again.
 */

export type ClockKind = "WORK" | "MEAL" | "BREAK";

export interface Segment {
  start: number;
  end: number;
  /** No scan closed it: still going, or the day ended first. */
  open: boolean;
  /** Closed by the system overnight rather than by a scan. */
  closedBySystem: boolean;
  /** The scans that opened and closed it. Null when it began before the day, or is still open. */
  startScan: PresenceScan | null;
  endScan: PresenceScan | null;
}

export interface ClockSegment extends Segment {
  kind: ClockKind;
}

export interface DayLanes {
  gate: Segment[];
  clock: ClockSegment[];
  /** Inside another building, from that building's gate. Only this building's gate is drawn. */
  away: Segment[];
  /**
   * From leaving one building's gate to going in at another's. On the clock
   * that is the drive between warehouses, which is paid, so it is never a
   * missed gate scan.
   */
  moving: { start: number; end: number }[];
  totals: {
    insideMin: number;
    workMin: number;
    mealMin: number;
    breakMin: number;
    /** Inside the building and not on the clock, meals and breaks aside. */
    insideOffClockMin: number;
    /** On the clock while the gate says they were outside, and not inside another building. */
    workOutsideMin: number;
    /** On the clock inside another building. */
    workAwayMin: number;
  };
  firstIn: number | null;
  lastOut: number | null;
  /**
   * The time clock's own first clock in and last clock out that day, apart
   * from the gate: the schedule's start and end are measured against these,
   * because the schedule says when to clock in, not when to walk in. A shift
   * carried over from yesterday has no clock in today; one still open has no
   * clock out yet.
   */
  clockIn: number | null;
  clockOut: number | null;
  /** Gate exits with no entry before them: out through the gate, never seen coming in. */
  exitsWithoutEntry: PresenceScan[];
  /** The stretches behind the two gap totals, in order, so a day can list them. */
  gaps: {
    /** Inside the building, not on the clock and not on a meal or break. */
    insideOffClock: { start: number; end: number }[];
    /** On the clock while the gate had them outside. */
    workOutside: { start: number; end: number }[];
  };
}

type ClockState = ClockKind | "OUT";

/** A second exit read this soon after the last one, with no entry between, is the same exit. */
const REPEAT_EXIT_MS = 5 * 60 * 1000;

/** What the timecard made of a time clock scan, falling back to the tablet's direction. */
export function clockStateAfter(s: PresenceScan): ClockState | null {
  if (s.automatic) return "OUT";
  switch (s.punchType) {
    case "CLOCK_IN":
    case "MEAL_END":
    case "BREAK_END":
      return "WORK";
    case "MEAL_START":
      return "MEAL";
    case "BREAK_START":
      return "BREAK";
    case "CLOCK_OUT":
      return "OUT";
  }
  if (s.direction === "IN") return "WORK";
  if (s.direction === "OUT") return "OUT";
  return null;
}

export function buildLanes({
  scans,
  carryGate,
  carryClock,
  away = [],
  carryAway = null,
  from,
  to,
}: {
  scans: PresenceScan[];
  /** The last gate scan before the day, if it left them inside. */
  carryGate: PresenceScan | null;
  carryClock: PresenceScan | null;
  /** Gate scans at other buildings, and the last one before the day. */
  away?: PresenceScan[];
  carryAway?: PresenceScan | null;
  /** Start of the day. */
  from: number;
  /** End of the day, or now when the day is today. */
  to: number;
}): DayLanes {
  const asc = [...scans].sort((a, b) => a.at.localeCompare(b.at));

  // ── Gate ──
  const here = asc.filter((s) => !s.site);
  const { segments: gate, exitsWithoutEntry } = insideStretches(here, carryGate, from, to);
  const awayLane = insideStretches(
    [...away].sort((a, b) => a.at.localeCompare(b.at)),
    carryAway,
    from,
    to,
  ).segments;

  // ── Time clock ──
  // A scan the timecard refused changed nothing, so it moves no lane.
  const clock: ClockSegment[] = [];
  let state: ClockState = carryClock ? clockStateAfter(carryClock) ?? "OUT" : "OUT";
  let since = from;
  let sinceScan: PresenceScan | null = null;
  for (const s of asc) {
    if (s.stream !== "TIME_CLOCK" || s.rejected) continue;
    const next = clockStateAfter(s);
    if (!next || next === state) continue;
    const t = Date.parse(s.at);
    if (state !== "OUT" && t > since)
      clock.push({ kind: state, start: since, end: t, open: false, closedBySystem: s.automatic, startScan: sinceScan, endScan: s });
    state = next;
    since = t;
    sinceScan = s;
  }
  if (state !== "OUT" && to > since)
    clock.push({ kind: state, start: since, end: to, open: true, closedBySystem: false, startScan: sinceScan, endScan: null });

  const work = clock.filter((c) => c.kind === "WORK");
  const minutes = (segs: { start: number; end: number }[]) =>
    // Whole minutes, rounded down, the way every duration on the page reads.
    Math.floor(segs.reduce((n, s) => n + (s.end - s.start), 0) / 60000);

  const onBreak = clock.filter((c) => c.kind !== "WORK");
  const offClockInside = subtract(subtract(gate, work), onBreak);
  const workAway = subtract(subtract(work, gate), subtract(work, awayLane));
  const moving = betweenBuildings(gate, awayLane);
  const workOutside = subtract(subtract(subtract(work, gate), awayLane), moving);

  // Arriving and leaving are this building's: a clock in at another
  // warehouse is not walking in here.
  const ins = here.filter((s) => s.direction === "IN" && !s.automatic && !s.rejected).map((s) => Date.parse(s.at));
  const outs = here.filter((s) => s.direction === "OUT" && !s.automatic && !s.rejected).map((s) => Date.parse(s.at));

  return {
    gate,
    clock,
    away: awayLane,
    moving,
    totals: {
      insideMin: minutes(gate),
      workMin: minutes(work),
      mealMin: minutes(clock.filter((c) => c.kind === "MEAL")),
      breakMin: minutes(clock.filter((c) => c.kind === "BREAK")),
      insideOffClockMin: minutes(offClockInside),
      workOutsideMin: minutes(workOutside),
      workAwayMin: minutes(workAway),
    },
    firstIn: ins.length ? ins[0] : null,
    lastOut: outs.length ? outs[outs.length - 1] : null,
    // A clock in is a stretch that starts from being clocked out: a scan
    // began it and nothing ran right up to it. A meal ending is not one.
    clockIn:
      clock.find((c, i) => c.startScan !== null && (i === 0 || clock[i - 1].end < c.start))?.start ?? null,
    clockOut: clock.length && !clock[clock.length - 1].open ? clock[clock.length - 1].end : null,
    exitsWithoutEntry,
    gaps: {
      insideOffClock: offClockInside.sort((a, b) => a.start - b.start),
      workOutside: workOutside.sort((a, b) => a.start - b.start),
    },
  };
}

/**
 * What the Left column says: still in the building, or out of it since when,
 * and what the time clock has them doing meanwhile.
 *
 * <p>Where there is a gate, the building is the gate's to say. The time clock
 * only says whether their day is over, which is a different question:
 * somebody eating outside has left the building and is still on shift, and
 * somebody the time clock recorded as starting a meal when they meant to
 * clock out (2026-09-23, 117 people across three sites) has gone home.
 * Asking the clock "are they here" showed both as on site.
 *
 * <p>Without a gate reading for them, the clock is all there is, so it
 * decides on its own, as it always has.
 */
export function leftBuilding(
  lanes: DayLanes,
  hasGate: boolean,
): { onSite: boolean; leftAt: number | null; clock: ClockState } {
  const openClock = lanes.clock.find((c) => c.open);
  const clock: ClockState = openClock ? openClock.kind : "OUT";
  const gateSeen = hasGate && (lanes.gate.length > 0 || lanes.exitsWithoutEntry.length > 0);

  if (!gateSeen) {
    const onSite = clock !== "OUT";
    const leftAt =
      !onSite && lanes.lastOut && lanes.firstIn && lanes.lastOut > lanes.firstIn ? lanes.lastOut : null;
    return { onSite, leftAt, clock };
  }

  if (lanes.gate.some((g) => g.open)) return { onSite: true, leftAt: null, clock };
  // The overnight auto close is not somebody walking out, so it is no exit time.
  const exits = [
    ...lanes.gate.filter((g) => !g.closedBySystem).map((g) => g.end),
    ...lanes.exitsWithoutEntry.map((s) => Date.parse(s.at)),
  ];
  return { onSite: false, leftAt: exits.length ? Math.max(...exits) : null, clock };
}

/**
 * The gaps between walking out of one building and into a different one,
 * this building and another or two others.
 */
function betweenBuildings(gate: Segment[], away: Segment[]): { start: number; end: number }[] {
  const where = (g: Segment) => g.startScan?.site ?? g.endScan?.site ?? "another";
  const stays = [
    ...gate.map((g) => ({ g, at: "here" })),
    ...away.map((g) => ({ g, at: where(g) })),
  ].sort((a, b) => a.g.start - b.g.start);
  const out: { start: number; end: number }[] = [];
  for (let i = 1; i < stays.length; i++) {
    const a = stays[i - 1];
    const b = stays[i];
    if (a.at !== b.at && !a.g.open && b.g.start > a.g.end) out.push({ start: a.g.end, end: b.g.start });
  }
  return out;
}

/**
 * When somebody was inside a building, from its gate scans in order, starting
 * from whatever the last scan before the day left them in.
 */
function insideStretches(
  asc: PresenceScan[],
  carry: PresenceScan | null,
  from: number,
  to: number,
): { segments: Segment[]; exitsWithoutEntry: PresenceScan[] } {
  const segments: Segment[] = [];
  const exitsWithoutEntry: PresenceScan[] = [];
  let inside: number | null = carry && carry.direction === "IN" && !carry.automatic ? from : null;
  let insideScan: PresenceScan | null = null;
  let lastExit: number | null = null;
  for (const s of asc) {
    if (s.stream !== "SECURITY" || s.direction === "UNKNOWN" || s.reread) continue;
    const t = Date.parse(s.at);
    if (s.direction === "IN") {
      lastExit = null;
      if (inside === null) {
        inside = t;
        insideScan = s;
      }
    } else if (inside !== null) {
      segments.push({ start: inside, end: t, open: false, closedBySystem: s.automatic, startScan: insideScan, endScan: s });
      inside = null;
      insideScan = null;
      lastExit = t;
    } else if (!s.automatic && (lastExit === null || t - lastExit > REPEAT_EXIT_MS)) {
      exitsWithoutEntry.push(s);
      lastExit = t;
    }
  }
  if (inside !== null && to > inside)
    segments.push({ start: inside, end: to, open: true, closedBySystem: false, startScan: insideScan, endScan: null });
  return { segments, exitsWithoutEntry };
}

/** The parts of `a` not covered by any of `b`. */
function subtract(a: { start: number; end: number }[], b: { start: number; end: number }[]) {
  let out = a.map((s) => ({ start: s.start, end: s.end }));
  for (const cut of b) {
    const next: { start: number; end: number }[] = [];
    for (const s of out) {
      if (cut.end <= s.start || cut.start >= s.end) {
        next.push(s);
        continue;
      }
      if (cut.start > s.start) next.push({ start: s.start, end: cut.start });
      if (cut.end < s.end) next.push({ start: cut.end, end: s.end });
    }
    out = next;
  }
  return out;
}
