import type { Tablet, TabletCheck } from "@/lib/presence/tablets.service";
import type { DeviceAlert } from "@/lib/devices/check-in";

/**
 * How a tablet is doing, in the three groups the Tablets window and its chip
 * on Live Attendance both use, so the two never disagree.
 */
export type Health = "ATTENTION" | "WORKING" | "UPDATE";

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
  DIRTY_BUILD: { short: "Test build", todo: "It is running a test copy of the app. Ask IT to install the regular build." },
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

export function healthOf(t: Tablet): Health {
  if (t.status === "NOT_REPORTING") return "UPDATE";
  if (t.status === "OFFLINE" || issuesOf(t).length > 0) return "ATTENTION";
  return "WORKING";
}

export function countHealth(tablets: Tablet[]): Record<Health, number> {
  const out: Record<Health, number> = { ATTENTION: 0, WORKING: 0, UPDATE: 0 };
  for (const t of tablets) out[healthOf(t)]++;
  return out;
}
