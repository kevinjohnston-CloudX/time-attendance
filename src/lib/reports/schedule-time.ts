/**
 * When a scheduled report next goes out.
 *
 * <p>A schedule is a five field cron expression read in the schedule's own
 * time zone: minute, hour, day of the month, month, day of the week. Two
 * things the old calculator got wrong are fixed here. It read every
 * expression in UTC whatever zone the schedule named, so "8:00 AM Eastern"
 * went out at 4:00 AM or 3:00 AM depending on the season. And it could not say
 * "the last day of the month", which five plain fields cannot, so an `L` is
 * accepted in the day of the month field (`0 20 L * *`).
 *
 * <p>Pure functions with no database or framework, so the schedule form can
 * show the next send on screen with the same code the server uses to decide it.
 */

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    FORMATTERS.set(timeZone, f);
  }
  return f;
}

/** The wall clock in a zone at an instant. */
export function zonedParts(instant: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

/** Minutes the zone is ahead of UTC at an instant (negative in the Americas). */
function offsetMinutes(instantMs: number, timeZone: string): number {
  const p = zonedParts(new Date(instantMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall clock time happens in a zone. A time the clocks skip
 * (the hour lost in spring) lands on the same minute after the jump; a time
 * the clocks repeat (the hour gained in autumn) takes the first of the two.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // The offsets in force a day either side bracket any clock change.
  const before = offsetMinutes(guess - 86_400_000, timeZone);
  const after = offsetMinutes(guess + 86_400_000, timeZone);
  const hits = [...new Set([before, after])]
    .map((off) => guess - off * 60_000)
    .filter((ms) => {
      const p = zonedParts(new Date(ms), timeZone);
      return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
    });
  if (hits.length) return new Date(Math.min(...hits));
  // The time is in the hour the clocks skip: use the offset from before the
  // jump, which puts it at the same reading just after.
  return new Date(guess - before * 60_000);
}

interface Field {
  values: Set<number>;
  star: boolean;
  last?: boolean;
}

function parseField(text: string, min: number, max: number, allowLast: boolean): Field {
  if (text === "*") {
    const values = new Set<number>();
    for (let v = min; v <= max; v++) values.add(v);
    return { values, star: true };
  }
  const values = new Set<number>();
  let last = false;
  for (const part of text.split(",")) {
    if (allowLast && part === "L") {
      last = true;
      continue;
    }
    const [rangeText, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid schedule step in "${part}"`);
    let from: number;
    let to: number;
    if (rangeText === "*") {
      from = min;
      to = max;
    } else if (rangeText.includes("-")) {
      const [a, b] = rangeText.split("-").map(Number);
      from = a;
      to = b;
    } else {
      from = Number(rangeText);
      to = stepText === undefined ? from : max;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new Error(`Invalid schedule value "${part}"`);
    }
    for (let v = from; v <= to; v += step) values.add(v);
  }
  if (!values.size && !last) throw new Error(`Invalid schedule field "${text}"`);
  return { values, star: false, last };
}

export interface ParsedSchedule {
  minutes: number[];
  hours: number[];
  dom: Field;
  months: Set<number>;
  dow: Field;
}

/** Reads the five fields. Throws a plain message when they do not make sense. */
export function parseSchedule(cronExpr: string): ParsedSchedule {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("A schedule needs five values: minute, hour, day, month, weekday.");
  const [m, h, dom, mon, dow] = parts;
  const dowField = parseField(dow, 0, 7, false);
  // Sunday is both 0 and 7.
  if (dowField.values.delete(7)) dowField.values.add(0);
  return {
    minutes: [...parseField(m, 0, 59, false).values].sort((a, b) => a - b),
    hours: [...parseField(h, 0, 23, false).values].sort((a, b) => a - b),
    dom: parseField(dom, 1, 31, true),
    months: parseField(mon, 1, 12, false).values,
    dow: dowField,
  };
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function dayMatches(s: ParsedSchedule, year: number, month: number, day: number): boolean {
  if (!s.months.has(month)) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const domHit = s.dom.values.has(day) || (!!s.dom.last && day === daysInMonth(year, month));
  const dowHit = s.dow.values.has(weekday);
  // As in every cron: when both the day of the month and the weekday are
  // narrowed, either one matching is enough.
  if (!s.dom.star && !s.dow.star) return domHit || dowHit;
  if (!s.dom.star) return domHit;
  if (!s.dow.star) return dowHit;
  return true;
}

/**
 * The first send strictly after an instant, or null when the expression never
 * fires (31 February). Looks as far ahead as eight years, enough for 29
 * February.
 */
export function nextRun(cronExpr: string, timeZone: string, after: Date = new Date()): Date | null {
  const s = parseSchedule(cronExpr);
  const start = zonedParts(after, timeZone);
  for (let offset = 0; offset <= 366 * 8; offset++) {
    const d = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (!dayMatches(s, year, month, day)) continue;
    for (const hour of s.hours) {
      for (const minute of s.minutes) {
        const at = zonedTimeToUtc(year, month, day, hour, minute, timeZone);
        if (at.getTime() > after.getTime()) return at;
      }
    }
  }
  return null;
}

/** A zone name the runtime knows, so a bad one cannot reach the calculator. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
