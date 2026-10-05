import { db } from "@/lib/db";
import { deviceAlerts, SILENT_MS, type DeviceAlert } from "@/lib/devices/check-in";

/**
 * The tablets at one building, for the Tablets window on Live Attendance.
 *
 * <p>Two sources, merged by name. Tablets on build 163 and later check in
 * every five minutes (devices, see device.prisma): battery, connection,
 * queue, storage and the rest. Older builds never check in, so they are
 * found from their own scans over the last {@link LOOK_BACK_DAYS} days, with
 * only what a scan carries (name, gate or clock, app version, last scan), and
 * marked as not reporting.
 */

const LOOK_BACK_DAYS = 7;
/** For gate readiness: a gate tablet that has not scanned in this long is not at a door. */
const READINESS_DAYS = 2;
/** The first build that sends its building with every gate check (confirmed at 299, Oct 2). */
export const SENDS_BUILDING_FROM = 163;

export type TabletStatus = "ONLINE" | "OFFLINE" | "NOT_REPORTING";

export interface Tablet {
  key: string;
  name: string;
  /** SECURITY (a gate) or TIME_CLOCK, or null when it has never said. */
  stream: string | null;
  status: TabletStatus;
  appVersion: string | null;
  /** Whether this build sends its building on every gate check. */
  sendsBuilding: boolean;
  lastScanAt: string | null;
  // Only from check-ins; null for a tablet that does not report.
  lastSeenAt: string | null;
  firstSeenAt: string | null;
  model: string | null;
  android: string | null;
  batteryPct: number | null;
  charging: boolean | null;
  plugged: string | null;
  batteryTempC: number | null;
  network: string | null;
  wifiRssi: number | null;
  wifiName: string | null;
  scansToday: number | null;
  pending: number | null;
  failed: number | null;
  oldestPendingSec: number | null;
  storageFreeMb: number | null;
  storageTotalMb: number | null;
  cameraOk: boolean | null;
  autoTime: boolean | null;
  clockSkewSec: number | null;
  /** True while CloudTime is the app in front. */
  appOpen: boolean | null;
  bootedAt: string | null;
  serial: string | null;
  assetTag: string | null;
  reinstalls: number;
  alerts: DeviceAlert[];
}

export interface BuildingTablets {
  site: { id: string; name: string; timezone: string };
  tablets: Tablet[];
  checkedAt: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = 80): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The number at the front of an app version ("159-sec" is 159), or null. */
export function buildNumber(version: string | null): number | null {
  const n = version ? parseInt(version, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

const sendsBuilding = (version: string | null) => (buildNumber(version) ?? 0) >= SENDS_BUILDING_FROM;

/** Every tablet seen in this building's live scans lately: its latest name, build and kind. */
async function tabletsInScans(tenantId: string, warehouses: number[], days = LOOK_BACK_DAYS) {
  if (warehouses.length === 0) return [];
  const since = new Date(Date.now() - days * 86_400_000);
  return db.$queryRaw<{ site: string; deviceName: string; appVersion: string | null; stream: string; at: Date }[]>`
    SELECT DISTINCT ON (site, lower("deviceName"))
           site, "deviceName", "appVersion", stream::text AS stream, "createdAt" AS at
    FROM   scan_events
    WHERE  "tenantId" = ${tenantId}
      AND  site = ANY(${warehouses.map(String)})
      AND  "deviceName" IS NOT NULL
      AND  "sourceSlot" = 'LIVE'
      -- Rows put back by the Sep 29 scan recovery name no real tablet.
      AND  "appVersion" IS DISTINCT FROM 'recovered'
      AND  "deviceName" NOT ILIKE 'RECOVERED-%'
      AND  "createdAt" > ${since}
    ORDER  BY site, lower("deviceName"), "createdAt" DESC`;
}

/** The caller has checked the viewer may see this building. */
export async function getBuildingTablets(tenantId: string, siteId: string, now = new Date()): Promise<BuildingTablets | null> {
  const site = await db.site.findFirst({
    where: { id: siteId, tenantId },
    select: { id: true, name: true, timezone: true, wmsWarehouseId: true },
  });
  if (!site) return null;
  const [devices, scanned] = await Promise.all([
    db.device.findMany({ where: { tenantId, siteId } }),
    tabletsInScans(tenantId, site.wmsWarehouseId === null ? [] : [site.wmsWarehouseId]),
  ]);
  const lastScan = new Map(scanned.map((s) => [s.deviceName.toLowerCase(), s]));

  const tablets: Tablet[] = devices.map((d) => {
    const report = obj(d.lastReport);
    const power = obj(report.power);
    const network = obj(report.network);
    const queue = obj(report.queue);
    const storage = obj(report.storage);
    const health = obj(report.health);
    const scan = d.deviceName ? lastScan.get(d.deviceName.toLowerCase()) : undefined;
    const totalBytes = num(storage.DataTotalBytes);
    return {
      key: d.id,
      name: d.deviceName ?? d.assetTag ?? d.model ?? "Unnamed tablet",
      stream: d.stream,
      status: now.getTime() - d.lastSeenAt.getTime() > SILENT_MS ? "OFFLINE" : "ONLINE",
      appVersion: d.appVersion,
      sendsBuilding: sendsBuilding(d.appVersion),
      lastScanAt: scan?.at.toISOString() ?? null,
      lastSeenAt: d.lastSeenAt.toISOString(),
      firstSeenAt: d.firstSeenAt.toISOString(),
      model: [d.manufacturer, d.model].filter(Boolean).join(" ") || null,
      android: d.androidVersion,
      batteryPct: d.batteryPct,
      charging: d.charging,
      plugged: d.plugged,
      batteryTempC: num(power.BatteryTempC),
      network: d.networkType,
      wifiRssi: d.wifiRssi,
      wifiName: text(network.WifiSsid)?.replace(/^"|"$/g, "") ?? null,
      scansToday: num(queue.ScansToday),
      pending: d.queuePending,
      failed: d.queueFailed,
      oldestPendingSec: d.oldestPendingSec,
      storageFreeMb: d.dataFreeMb,
      storageTotalMb: totalBytes === null ? null : Math.round(totalBytes / 1_048_576),
      cameraOk: d.cameraPermission,
      autoTime: d.autoTime,
      clockSkewSec: d.clockSkewSec,
      appOpen: d.screen === null ? null : d.screen !== "BACKGROUND",
      bootedAt: isoOrNull(health.BootedAt),
      serial: d.hardwareSerial,
      assetTag: d.assetTag,
      reinstalls: d.installChanges,
      alerts: deviceAlerts(d, now),
    };
  });

  const reporting = new Set(devices.map((d) => d.deviceName?.toLowerCase()).filter(Boolean));
  for (const s of scanned) {
    if (reporting.has(s.deviceName.toLowerCase())) continue;
    tablets.push({
      key: `scan:${s.deviceName.toLowerCase()}`,
      name: s.deviceName,
      stream: s.stream,
      status: "NOT_REPORTING",
      appVersion: s.appVersion,
      sendsBuilding: sendsBuilding(s.appVersion),
      lastScanAt: s.at.toISOString(),
      lastSeenAt: null,
      firstSeenAt: null,
      model: null,
      android: null,
      batteryPct: null,
      charging: null,
      plugged: null,
      batteryTempC: null,
      network: null,
      wifiRssi: null,
      wifiName: null,
      scansToday: null,
      pending: null,
      failed: null,
      oldestPendingSec: null,
      storageFreeMb: null,
      storageTotalMb: null,
      cameraOk: null,
      autoTime: null,
      clockSkewSec: null,
      appOpen: null,
      bootedAt: null,
      serial: null,
      assetTag: null,
      reinstalls: 0,
      alerts: [],
    });
  }

  tablets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  return { site: { id: site.id, name: site.name, timezone: site.timezone }, tablets, checkedAt: now.toISOString() };
}

export interface GateReadiness {
  /** Gate tablets seen in this building's scans lately. */
  gates: number;
  /** Of those, on a build that sends its building. */
  sendingBuilding: number;
}

/** For the gate alert window: per building, how many of its gate tablets send their building. */
export async function getGateReadiness(
  tenantId: string,
  sites: { id: string; wmsWarehouseId: number | null }[],
): Promise<Map<string, GateReadiness>> {
  const bySite = new Map(sites.filter((s) => s.wmsWarehouseId !== null).map((s) => [String(s.wmsWarehouseId), s.id]));
  const scanned = await tabletsInScans(tenantId, [...bySite.keys()].map(Number), READINESS_DAYS);
  const out = new Map<string, GateReadiness>();
  for (const s of scanned) {
    if (s.stream !== "SECURITY") continue;
    const siteId = bySite.get(s.site);
    if (!siteId) continue;
    const r = out.get(siteId) ?? { gates: 0, sendingBuilding: 0 };
    r.gates++;
    if (sendsBuilding(s.appVersion)) r.sendingBuilding++;
    out.set(siteId, r);
  }
  return out;
}
