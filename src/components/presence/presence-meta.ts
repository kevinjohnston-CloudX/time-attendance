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
    label: "No gate scan",
    heading: "Clocked in, no gate scan",
    hint: "On the clock, but the security gate did not see them come in",
    color: "var(--ps-working)",
    badge: "warning",
  },
  ON_MEAL: {
    label: "On break",
    heading: "On meal or break",
    hint: "Clocked out for a meal or a rest break",
    color: "var(--ps-meal)",
    badge: "warning",
  },
  OFF_CLOCK: {
    label: "Off the clock",
    heading: "Inside, off the clock",
    hint: "Came through the security gate and is not clocked in",
    color: "var(--ps-offclock)",
    badge: "purple",
  },
  NOT_ARRIVED: {
    label: "Not arrived",
    heading: "Scheduled, not arrived",
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
};

/** The four that make up the building total, in the order the board lists them. */
export const INSIDE_STATUSES: PresenceStatus[] = ["WORKING", "NO_GATE_SCAN", "ON_MEAL", "OFF_CLOCK"];
export const AWAY_STATUSES: PresenceStatus[] = ["NOT_ARRIVED", "LEFT", "ON_LEAVE"];

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
      return at ? `Inside since ${at}` : "Inside";
    case "LEFT":
      return at ? `Left at ${at}` : "Left";
    case "NOT_ARRIVED":
      return p.scheduledStart ? `Due ${formatTimeOfDay(p.scheduledStart)}` : "Scheduled today";
    case "ON_LEAVE":
      return "Approved time off";
  }
}

/** What a reader event means, in words a person at HR would use. */
export function describeScan(s: PresenceScan): string {
  if (s.stream === "SECURITY") {
    if (s.automatic) return s.direction === "OUT" ? "Marked out overnight, no exit scan" : "Starting point from the old system";
    if (s.direction === "IN") return "Entered through the security gate";
    if (s.direction === "OUT") return "Left through the security gate";
    return "Security gate scan, direction unknown";
  }
  if (s.automatic) return "Clocked out overnight, no clock out scan";
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
  if (s.direction === "IN") return "Time clock scan in";
  if (s.direction === "OUT") return "Time clock scan out";
  return "Time clock scan, direction unknown";
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
