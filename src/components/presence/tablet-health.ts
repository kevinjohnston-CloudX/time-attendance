import type { Tablet, TabletCheck } from "@/lib/presence/tablets.service";
import type { DeviceAlert } from "@/lib/devices/check-in";

/**
 * How a tablet is doing, in the three groups the Tablets window and the
 * building menu on Live Attendance both use, so the two never disagree.
 * OUT_OF_DATE is a tablet on an older build than the newest one in use, so it
 * keeps meaning something after every rollout, not only this one.
 */
export type Health = "ATTENTION" | "WORKING" | "OUT_OF_DATE";

/** A working tablet's problem, and what to do about it, in words. */
export const ALERT_TEXT: Partial<Record<DeviceAlert, { short: string; todo: string }>> = {
  UNPLUGGED: { short: "Unplugged", todo: "It is running on battery. Plug it back into power." },
  QUEUE_STUCK: {
    short: "Scans not going out",
    todo: "Scans are waiting on the tablet and not reaching CloudTime. Check its Wi-Fi.",
  },
  CAMERA_OFF: {
    short: "Camera blocked",
    todo: "Camera access is turned off in the tablet's settings, so no photo is taken at a scan.",
  },
  CLOCK_OFF: {
    short: "Clock is wrong",
    todo: "Its clock is off, so scan times may be wrong. Turn on automatic time in the tablet's settings.",
  },
  LOW_STORAGE: {
    short: "Storage almost full",
    todo: "Its storage is almost full. Ask IT to clear it before it stops saving scans.",
  },
  DIRTY_BUILD: {
    short: "Test build",
    todo: "It is running a test copy of the app. Ask IT to install the regular build.",
  },
};

/** Problems worked out from the report itself (see TabletCheck), in the same words. */
export const CHECK_TEXT: Record<TabletCheck, { short: string; todo: string }> = {
  LATE_TO_CLOUDTIME: {
    short: "Scans late reaching CloudTime",
    todo: "Some of its scans are overdue reaching CloudTime, so Live Attendance may be missing them. Check its Wi-Fi.",
  },
  RUNNING_HOT: {
    short: "Running hot",
    todo: "Its battery is very warm. Move it out of the sun or away from heat, and check its charger.",
  },
  BATTERY_WORN: {
    short: "Battery wearing out",
    todo: "Android rates its battery as worn. Ask IT to plan a replacement before it stops holding a charge.",
  },
  WRONG_TIME_ZONE: {
    short: "Wrong time zone",
    todo: "It is set to a different time zone from this building, so the times it shows people may be off. Ask IT to set the building's time zone.",
  },
};

export const issuesOf = (t: Tablet) => [
  ...t.alerts.map((a) => ALERT_TEXT[a]).filter((x): x is { short: string; todo: string } => Boolean(x)),
  ...(t.checks ?? []).map((c) => CHECK_TEXT[c]),
];

/**
 * A problem outranks being behind: a tablet that is down needs somebody
 * whatever its build. A tablet too old to report has no health to judge, so
 * it is simply out of date; one on a current build that still sends no
 * reports is a problem of its own.
 */
export function healthOf(t: Tablet): Health {
  if (t.status === "NOT_REPORTING") return t.outOfDate ? "OUT_OF_DATE" : "ATTENTION";
  if (t.status === "OFFLINE" || issuesOf(t).length > 0) return "ATTENTION";
  return t.outOfDate ? "OUT_OF_DATE" : "WORKING";
}

export type StatusTone = "error" | "warning" | "success" | "neutral";

/** A tablet's state as one badge and one short line, the same in the list and the detail. */
export function statusOf(t: Tablet, newestBuild: number): { tone: StatusTone; label: string; line: string } {
  const h = healthOf(t);
  if (t.status === "OFFLINE") return { tone: "error", label: "Not responding", line: "Not responding" };
  if (h === "ATTENTION") {
    const issue = issuesOf(t)[0];
    return { tone: "warning", label: "Needs attention", line: issue ? issue.short : "Not sending reports" };
  }
  if (h === "OUT_OF_DATE")
    return {
      tone: "neutral",
      label: "Out of date",
      line: `Build ${t.appVersion ?? "unknown"}, newest is ${newestBuild}`,
    };
  return {
    tone: "success",
    label: "Working",
    line: t.batteryPct === null ? "Working" : `Working, battery ${t.batteryPct}%`,
  };
}

export function countHealth(tablets: Tablet[]): Record<Health, number> {
  const out: Record<Health, number> = { ATTENTION: 0, WORKING: 0, OUT_OF_DATE: 0 };
  for (const t of tablets) out[healthOf(t)]++;
  return out;
}
