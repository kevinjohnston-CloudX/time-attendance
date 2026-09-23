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
  totals: {
    insideMin: number;
    workMin: number;
    mealMin: number;
    breakMin: number;
    /** Inside the building and not on the clock, meals and breaks aside. */
    insideOffClockMin: number;
    /** On the clock while the gate says they were outside. */
    workOutsideMin: number;
  };
  firstIn: number | null;
  lastOut: number | null;
  /** Gate exits with no entry before them: out through the gate, never seen coming in. */
  exitsWithoutEntry: PresenceScan[];
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
  from,
  to,
}: {
  scans: PresenceScan[];
  /** The last gate scan before the day, if it left them inside. */
  carryGate: PresenceScan | null;
  carryClock: PresenceScan | null;
  /** Start of the day. */
  from: number;
  /** End of the day, or now when the day is today. */
  to: number;
}): DayLanes {
  const asc = [...scans].sort((a, b) => a.at.localeCompare(b.at));

  // ── Gate ──
  const gate: Segment[] = [];
  const exitsWithoutEntry: PresenceScan[] = [];
  let inside: number | null = carryGate && carryGate.direction === "IN" && !carryGate.automatic ? from : null;
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
      gate.push({ start: inside, end: t, open: false, closedBySystem: s.automatic, startScan: insideScan, endScan: s });
      inside = null;
      insideScan = null;
      lastExit = t;
    } else if (!s.automatic && (lastExit === null || t - lastExit > REPEAT_EXIT_MS)) {
      exitsWithoutEntry.push(s);
      lastExit = t;
    }
  }
  if (inside !== null && to > inside)
    gate.push({ start: inside, end: to, open: true, closedBySystem: false, startScan: insideScan, endScan: null });

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
  const workOutside = subtract(work, gate);

  const ins = asc.filter((s) => s.direction === "IN" && !s.automatic && !s.rejected).map((s) => Date.parse(s.at));
  const outs = asc.filter((s) => s.direction === "OUT" && !s.automatic && !s.rejected).map((s) => Date.parse(s.at));

  return {
    gate,
    clock,
    totals: {
      insideMin: minutes(gate),
      workMin: minutes(work),
      mealMin: minutes(clock.filter((c) => c.kind === "MEAL")),
      breakMin: minutes(clock.filter((c) => c.kind === "BREAK")),
      insideOffClockMin: minutes(offClockInside),
      workOutsideMin: minutes(workOutside),
    },
    firstIn: ins.length ? ins[0] : null,
    lastOut: outs.length ? outs[outs.length - 1] : null,
    exitsWithoutEntry,
  };
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
