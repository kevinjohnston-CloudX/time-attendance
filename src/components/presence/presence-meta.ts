import { formatTimeOfDay } from "@/lib/utils/date";
import type { PresencePerson, PresenceScan, PresenceStatus } from "@/lib/presence/types";

/**
 * Names, colours and wording for each status on the On Site board, in one
 * place so the tile, the list, the panel and the export can never disagree.
 */

export interface StatusMeta {
  /** Short name: the counter, the badge, the export column. */
  label: string;
  /** The panel heading when a group of people is listed under it. */
  heading: string;
  /** One quiet line under that heading. */
  hint: string;
  /** Colour of the stripe under the photo. A CSS custom property from the board's stylesheet. */
  color: string;
  badge: "success" | "warning" | "purple" | "neutral" | "error" | "info";
}

export const STATUS_META: Record<PresenceStatus, StatusMeta> = {
  WORKING: {
    label: "Working",
    heading: "Working",
    hint: "On the clock and inside the building",
    color: "var(--ps-working)",
    badge: "success",
  },
  NO_GATE_SCAN: {
    label: "Clocked in, not inside",
    heading: "Clocked in, not inside",
    hint: "On the clock, but the security gate did not see them come in",
    color: "var(--ps-working)",
    badge: "warning",
  },
  ON_MEAL: {
    label: "On break",
    heading: "On a break",
    hint: "Clocked out for a meal or a rest break",
    color: "var(--ps-meal)",
    badge: "warning",
  },
  OFF_CLOCK: {
    label: "Inside, not clocked in",
    heading: "Inside, not clocked in",
    hint: "Came through the security gate and is not clocked in",
    color: "var(--ps-offclock)",
    badge: "purple",
  },
  ON_SITE: {
    label: "On site",
    heading: "On site, salaried",
    hint: "Salaried, so not expected to clock in. The security gate saw them come in",
    color: "var(--ps-working)",
    badge: "success",
  },
  NOT_ARRIVED: {
    label: "Not arrived",
    heading: "Not arrived",
    hint: "Scheduled to work today and not seen at any reader yet",
    color: "var(--ps-absent)",
    badge: "neutral",
  },
  LEFT: {
    label: "Left",
    heading: "Left for the day",
    hint: "Was here today and has gone",
    color: "var(--ps-left)",
    badge: "neutral",
  },
  ON_LEAVE: {
    label: "On leave",
    heading: "On leave today",
    hint: "Approved time off today",
    color: "var(--ps-left)",
    badge: "info",
  },
  NOT_SCHEDULED: {
    label: "Not scheduled",
    heading: "Not scheduled today",
    hint: "Based at this site, with no shift today and not seen at any reader",
    color: "var(--ps-left)",
    badge: "neutral",
  },
};

/** The four that make up the building total, in the order the board lists them. */
export const INSIDE_STATUSES: PresenceStatus[] = ["WORKING", "NO_GATE_SCAN", "ON_MEAL", "OFF_CLOCK", "ON_SITE"];
export const AWAY_STATUSES: PresenceStatus[] = ["NOT_ARRIVED", "LEFT", "ON_LEAVE", "NOT_SCHEDULED"];

/** A meal and a break share a status; the tile still says which one it is. */
export function statusLabel(p: PresencePerson): string {
  if (p.status === "ON_MEAL") return p.breakKind === "BREAK" ? "On break" : "On meal";
  return STATUS_META[p.status].label;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** "6:58 AM", in the site's own zone, whatever zone the viewer is in. */
export function fmtTime(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true });
    timeFormatters.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

/**
 * "6:58 AM" for today, "yesterday 6:36 PM" for anything earlier. A time with no
 * day reads as today, and somebody clocked in since yesterday evening is
 * exactly the person this page should not make look ordinary.
 */
export function fmtWhen(iso: string | null, timeZone: string, nowIso: string): string {
  if (!iso) return "";
  const t = fmtTime(iso, timeZone);
  return siteDate(iso, timeZone) === siteDate(nowIso, timeZone) ? t : `yesterday ${t}`;
}

/** The calendar date in the site's zone, for telling today from yesterday. */
export function siteDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

/** "45 min", "7 hr 12 min". Never negative, never seconds. */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr`;
}

export function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export function fmtShift(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = formatTimeOfDay(start);
  const e = formatTimeOfDay(end);
  return e ? `${s} to ${e}` : s;
}

/**
 * The line under a name on a tile: what they are doing, and since when.
 * Short enough to fit a 150px tile on one line.
 */
export function sinceLine(p: PresencePerson, timeZone: string, nowIso: string): string {
  const at = fmtWhen(p.since, timeZone, nowIso);
  switch (p.status) {
    case "WORKING":
    case "NO_GATE_SCAN":
      return at ? `In since ${at}` : "On the clock";
    case "ON_MEAL":
      return at ? `${p.breakKind === "BREAK" ? "Break" : "Meal"} since ${at}` : statusLabel(p);
    case "OFF_CLOCK":
    case "ON_SITE":
      return at ? `Inside since ${at}` : "Inside";
    case "LEFT":
      return at ? `Left at ${at}` : "Left";
    case "NOT_ARRIVED":
      return p.scheduledStart ? `Due ${formatTimeOfDay(p.scheduledStart)}` : "Scheduled today";
    case "ON_LEAVE":
      return "Approved time off";
    case "NOT_SCHEDULED":
      return "Not scheduled today";
  }
}

/** What a reader event means, in words a person at HR would use. */
export function describeScan(s: PresenceScan): string {
  if (s.stream === "SECURITY") {
    if (s.automatic) return s.direction === "OUT" ? "Never scanned out, closed by the system" : "Carried over from the old system";
    if (s.direction === "IN") return "Came in through the security gate";
    if (s.direction === "OUT") return "Left through the security gate";
    return "Security gate scan";
  }
  if (s.automatic) return "Never clocked out, closed by the system";
  switch (s.punchType) {
    case "CLOCK_IN":
      return "Clocked in";
    case "CLOCK_OUT":
      return "Clocked out";
    case "MEAL_START":
      return "Started meal";
    case "MEAL_END":
      return "Back from meal";
    case "BREAK_START":
      return "Started break";
    case "BREAK_END":
      return "Back from break";
  }
  return "Time clock scan";
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * The order people appear in under each heading.
 *
 * <p>Inside, alphabetical: somebody looking for a face is looking for a name.
 * Meals, longest first, because a meal that has run long is the one worth
 * noticing. Not arrived, latest first. Left, most recent first.
 */
export function comparePeople(a: PresencePerson, b: PresencePerson): number {
  if (a.status === "ON_MEAL" && b.status === "ON_MEAL") {
    return (a.since ?? "").localeCompare(b.since ?? "");
  }
  if (a.status === "NOT_ARRIVED" && b.status === "NOT_ARRIVED") {
    const late = (b.lateMinutes ?? -1) - (a.lateMinutes ?? -1);
    if (late !== 0) return late;
    return (a.scheduledStart ?? "99").localeCompare(b.scheduledStart ?? "99") || a.name.localeCompare(b.name);
  }
  if (a.status === "LEFT" && b.status === "LEFT") {
    return (b.since ?? "").localeCompare(a.since ?? "");
  }
  return a.name.localeCompare(b.name);
}

/* ── Sorting ─────────────────────────────────────────────────────────────── */

export type SortKey = "default" | "name" | "department" | "arrival" | "since" | "scheduled" | "status";
export type SortDir = "asc" | "desc";
export interface Sort {
  key: SortKey;
  dir: SortDir;
}

/**
 * The sort menu, in the order it lists them. "Recommended" is the order each
 * group already had: names inside, longest meal first, latest arrival first.
 */
export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "default", label: "Recommended" },
  { key: "name", label: "Name" },
  { key: "department", label: "Department" },
  { key: "arrival", label: "Arrival time" },
  { key: "since", label: "Time in status" },
  { key: "scheduled", label: "Scheduled start" },
];

export const SORT_LABEL: Record<SortKey, string> = {
  default: "Recommended",
  name: "Name",
  department: "Department",
  arrival: "Arrival time",
  since: "Time in status",
  scheduled: "Scheduled start",
  status: "Status",
};

const STATUS_ORDER: PresenceStatus[] = [...INSIDE_STATUSES, ...AWAY_STATUSES];

/** In the address bar as "name" or "name-desc", so a sorted board can be shared. */
export function parseSort(raw: string | null | undefined): Sort {
  const [key, dir] = (raw ?? "").split("-");
  if (key && key in SORT_LABEL) return { key: key as SortKey, dir: dir === "desc" ? "desc" : "asc" };
  return { key: "default", dir: "asc" };
}

export function serializeSort(s: Sort): string | null {
  if (s.key === "default") return null;
  return s.dir === "desc" ? `${s.key}-desc` : s.key;
}

/**
 * One comparison for every surface. Anything missing (no department, never
 * arrived, not scheduled) goes last whichever way the column is sorted, so a
 * reversed list does not open on a wall of blanks. Ties fall back to name.
 */
export function compareBy(sort: Sort, a: PresencePerson, b: PresencePerson): number {
  if (sort.key === "default") return comparePeople(a, b);
  const flip = sort.dir === "desc" ? -1 : 1;
  const text = (x: string | null, y: string | null) => {
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return flip * x.localeCompare(y);
  };
  let r = 0;
  switch (sort.key) {
    case "name":
      r = flip * a.name.localeCompare(b.name);
      break;
    case "department":
      r = text(a.department, b.department);
      break;
    case "arrival":
      r = text(a.firstInToday, b.firstInToday);
      break;
    case "since":
      // Ascending is the oldest start first: whoever has been in this state longest.
      r = text(a.since, b.since);
      break;
    case "scheduled":
      r = text(a.scheduledStart, b.scheduledStart);
      break;
    case "status":
      r = flip * (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
      break;
  }
  return r || a.name.localeCompare(b.name);
}

/** People matching a search, by name or employee code. */
export function matchesSearch(p: PresencePerson, needle: string): boolean {
  if (!needle) return true;
  return p.name.toLowerCase().includes(needle) || p.employeeCode.toLowerCase().includes(needle);
}

/* ── The two readers, one line each ──────────────────────────────────────── */

export interface ReaderLine {
  reader: "gate" | "clock";
  /** What the reader says: "Inside", "Working", "Meal", "Left". */
  word: string;
  /** When, or for how long: "7:02 AM", "25 min". */
  value: string;
  /** This line is the reason the person is in a group worth a look. */
  tone: "warning" | null;
  /** The whole sentence, for the tooltip and the list. */
  title: string;
}

/**
 * What each reader last said about somebody, short enough for two lines under
 * a 150px card: a word, then a time. A time that is not today is never shown
 * bare, because it would read as today: an open stretch shows how long it has
 * run instead, and in amber, since a day that long is the one to look at.
 */
export function readerLines(p: PresencePerson, tz: string, now: number, hasGateData: boolean): ReaderLine[] {
  const nowIso = new Date(now).toISOString();
  const today = siteDate(nowIso, tz);
  const isToday = (iso: string) => siteDate(iso, tz) === today;
  const lines: ReaderLine[] = [];

  if (hasGateData) {
    const g = p.gate;
    if (!g) {
      lines.push({
        reader: "gate",
        word: "No scan",
        value: "",
        tone: p.status === "NO_GATE_SCAN" ? "warning" : null,
        title: "Security gate: no scan in the last 36 hours",
      });
    } else if (g.inside) {
      const long = !isToday(g.at);
      lines.push({
        reader: "gate",
        word: "Inside",
        value: long ? fmtDuration(minutesSince(g.at, now) ?? 0) : fmtTime(g.at, tz),
        tone: long ? "warning" : null,
        title: `Security gate: inside since ${fmtWhen(g.at, tz, nowIso)}`,
      });
    } else if (g.automatic) {
      lines.push({
        reader: "gate",
        word: "Never scanned out",
        value: "",
        tone: null,
        title: "Security gate: never scanned out, closed by the system overnight",
      });
    } else {
      lines.push({
        reader: "gate",
        word: "Left",
        value: isToday(g.at) ? fmtTime(g.at, tz) : "Yesterday",
        tone: p.status === "NO_GATE_SCAN" ? "warning" : null,
        title: `Security gate: left at ${fmtWhen(g.at, tz, nowIso)}`,
      });
    }
  }

  const c = p.clock;
  if (!c) {
    lines.push({
      reader: "clock",
      word: "No scan",
      value: "",
      tone: p.status === "OFF_CLOCK" ? "warning" : null,
      title: "Time clock: no scan in the last 36 hours",
    });
  } else if (c.state === "WORK") {
    const long = !isToday(c.at);
    lines.push({
      reader: "clock",
      word: "Working",
      value: long ? fmtDuration(minutesSince(c.at, now) ?? 0) : fmtTime(c.at, tz),
      tone: long ? "warning" : null,
      title: `Time clock: on the clock since ${fmtWhen(c.at, tz, nowIso)}`,
    });
  } else if (c.state === "MEAL" || c.state === "BREAK") {
    const word = c.state === "MEAL" ? "Meal" : "Break";
    lines.push({
      reader: "clock",
      word,
      value: fmtDuration(minutesSince(c.at, now) ?? 0),
      tone: null,
      title: `Time clock: ${word.toLowerCase()} since ${fmtWhen(c.at, tz, nowIso)}`,
    });
  } else if (c.automatic) {
    lines.push({
      reader: "clock",
      word: "Out",
      value: "Overnight",
      tone: null,
      title: "Time clock: clocked out overnight by the system, no clock out scan",
    });
  } else {
    lines.push({
      reader: "clock",
      word: "Out",
      value: isToday(c.at) ? fmtTime(c.at, tz) : "Yesterday",
      tone: p.status === "OFF_CLOCK" ? "warning" : null,
      title: `Time clock: clocked out at ${fmtWhen(c.at, tz, nowIso)}`,
    });
  }
  return lines;
}

/** Whose card carries the reader lines: everybody a reader has seen today. */
export function showsReaders(p: PresencePerson): boolean {
  return INSIDE_STATUSES.includes(p.status) || p.status === "LEFT";
}
