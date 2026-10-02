/**
 * The rules behind /api/timeclock/device-checkin, with no database in them.
 *
 * <p>Three questions: what a check-in says ({@link readReport}), which tablet
 * it is ({@link chooseDevice}), and what about that tablet is worth someone's
 * attention ({@link deviceAlerts}). The body is the one build 163 sends; its
 * contract is docs/device-telemetry-contract.md in the Android repo.
 *
 * <p><b>Read leniently.</b> This is diagnostic data from a fleet updated by
 * hand, one tablet at a time, so every field is optional and a field of the
 * wrong type is simply unknown. A check-in that says something is stored; only
 * one that names no identity at all is refused.
 */

/** A check-in, read into the fields CloudTime keeps. Null means "not said". */
export interface DeviceReport {
  installId: string | null;
  androidId: string | null;
  hardwareSerial: string | null;
  wifiMac: string | null;
  assetTag: string | null;
  isDeviceOwner: boolean | null;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;

  appVersion: string | null;
  gitSha: string | null;
  gitDirty: boolean | null;

  deviceName: string | null;
  warehouse: number | null;
  stream: string | null;

  batteryPct: number | null;
  charging: boolean | null;
  plugged: string | null;
  networkType: string | null;
  wifiRssi: number | null;

  queuePending: number | null;
  queueFailed: number | null;
  oldestPendingSec: number | null;
  dataFreeMb: number | null;

  cameraPermission: boolean | null;
  autoTime: boolean | null;
  screen: string | null;
  /** The tablet's clock when it sent this. */
  deviceTime: Date | null;
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(body: Obj, name: string): Obj {
  const value = body[name];
  return isObj(value) ? value : {};
}

/** A trimmed, bounded string, or null. Bounded because each lands in a column. */
function str(obj: Obj, key: string, max = 100): string | null {
  const value = obj[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** A finite whole number inside the Int column's range, or null. */
function int(obj: Obj, key: string): number | null {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return Math.abs(rounded) <= 2_147_483_647 ? rounded : null;
}

function bool(obj: Obj, key: string): boolean | null {
  const value = obj[key];
  return typeof value === "boolean" ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readReport(body: unknown): DeviceReport {
  const top = isObj(body) ? body : {};
  const identity = section(top, "identity");
  const build = section(top, "build");
  const setup = section(top, "setup");
  const power = section(top, "power");
  const network = section(top, "network");
  const queue = section(top, "queue");
  const storage = section(top, "storage");
  const health = section(top, "health");

  const installId = str(top, "InstallId")?.toLowerCase() ?? null;
  // A sticker is typed, or read by a scanner that may add spaces: one form.
  const assetTag = str(identity, "AssetTag", 64)?.toUpperCase() ?? null;
  const dataFreeBytes = storage.DataFreeBytes;
  const deviceTime = str(top, "DeviceTime", 40);
  const parsedTime = deviceTime ? new Date(deviceTime) : null;

  return {
    installId: installId && UUID.test(installId) ? installId : null,
    androidId: str(identity, "AndroidId", 64)?.toLowerCase() ?? null,
    hardwareSerial: str(identity, "HardwareSerial", 64),
    wifiMac: str(identity, "WifiMac", 32)?.toLowerCase() ?? null,
    assetTag,
    isDeviceOwner: bool(identity, "IsDeviceOwner"),
    manufacturer: str(identity, "Manufacturer"),
    model: str(identity, "Model"),
    androidVersion: str(identity, "AndroidVersion", 20),

    appVersion: str(build, "AppVersion", 32),
    gitSha: str(build, "GitSha", 40),
    gitDirty: bool(build, "GitDirty"),

    deviceName: str(setup, "DeviceName"),
    warehouse: int(setup, "Warehouse"),
    stream: str(setup, "Stream", 20),

    batteryPct: int(power, "BatteryPct"),
    charging: bool(power, "Charging"),
    plugged: str(power, "Plugged", 20),
    networkType: str(network, "Type", 20),
    wifiRssi: int(network, "WifiRssi"),

    queuePending: int(queue, "Pending"),
    queueFailed: int(queue, "FailedPermanent"),
    oldestPendingSec: int(queue, "OldestPendingAgeSec"),
    dataFreeMb:
      typeof dataFreeBytes === "number" && Number.isFinite(dataFreeBytes) && dataFreeBytes >= 0
        ? Math.floor(dataFreeBytes / (1024 * 1024))
        : null,

    cameraPermission: bool(health, "CameraPermission"),
    autoTime: bool(health, "AutoTime"),
    screen: str(health, "Screen", 60),
    deviceTime: parsedTime && !Number.isNaN(parsedTime.getTime()) ? parsedTime : null,
  };
}

/** True when the check-in names at least one id a tablet can be matched by. */
export function hasIdentity(r: DeviceReport): boolean {
  return Boolean(r.installId || r.hardwareSerial || r.wifiMac || r.androidId || r.assetTag);
}

/** The tablet's clock minus the server's, in whole seconds, or null. */
export function clockSkewSec(r: DeviceReport, receivedAt: Date): number | null {
  if (!r.deviceTime) return null;
  // `|| 0`: a tablet a fraction of a second behind rounds to -0, not 0.
  return Math.round((r.deviceTime.getTime() - receivedAt.getTime()) / 1000) || 0;
}

/** The ids a check-in is matched by, strongest first. */
export const MATCH_ORDER = ["installId", "hardwareSerial", "wifiMac", "androidId", "assetTag"] as const;
export type MatchKey = (typeof MATCH_ORDER)[number];

/** What chooseDevice needs to know about a stored tablet. */
export interface DeviceCandidate {
  id: string;
  installId: string | null;
  lastSeenAt: Date;
}

/**
 * How recently a tablet must have checked in to be "still running". One
 * interval (5 minutes) and some slack. Used only for the asset tag, below.
 */
export const ALIVE_MS = 7 * 60 * 1000;

export interface DeviceChoice {
  device: DeviceCandidate | null;
  by: MatchKey | null;
  /** The asset tag named a tablet that is still checking in as another install. */
  tagInUse: boolean;
}

/**
 * Which stored tablet a check-in belongs to, or none (a new tablet).
 *
 * <p>The install id first: it is this install, exactly. Then the ids that come
 * from the hardware, which outlive a reinstall or a reset: the serial and the
 * Wi-Fi MAC, then the Android id (kept through a reinstall and cleared data on
 * the fleet's single signing key). A match on any of them under a different
 * install id is the same tablet after a reset, and keeps its row.
 *
 * <p>The asset tag last, and with one guard, because a person types it: if the
 * tablet it names is still checking in under another install, the tag was
 * typed onto a second tablet by mistake, and merging the two would hide one of
 * them. That check-in becomes a new tablet instead, and the conflict is said.
 *
 * @param found for each key, the stored tablet with that value (null for none)
 */
export function chooseDevice(
  report: DeviceReport,
  found: Partial<Record<MatchKey, DeviceCandidate | null>>,
  now: Date,
): DeviceChoice {
  let tagInUse = false;
  for (const key of MATCH_ORDER) {
    const candidate = found[key];
    if (!candidate || report[key] === null) continue;
    if (key === "assetTag") {
      const otherInstall = candidate.installId !== null && candidate.installId !== report.installId;
      const alive = now.getTime() - candidate.lastSeenAt.getTime() < ALIVE_MS;
      if (otherInstall && alive) {
        tagInUse = true;
        continue;
      }
    }
    return { device: candidate, by: key, tagInUse };
  }
  return { device: null, by: null, tagInUse };
}

/** True when the check-in comes from a new install of a tablet already on file. */
export function installChanged(stored: DeviceCandidate, report: DeviceReport): boolean {
  return report.installId !== null && stored.installId !== null && stored.installId !== report.installId;
}

/** What deviceAlerts reads from a stored tablet. */
export interface AlertInput {
  lastSeenAt: Date;
  plugged: string | null;
  oldestPendingSec: number | null;
  cameraPermission: boolean | null;
  autoTime: boolean | null;
  clockSkewSec: number | null;
  dataFreeMb: number | null;
  gitDirty: boolean | null;
}

export type DeviceAlert =
  | "SILENT"
  | "UNPLUGGED"
  | "QUEUE_STUCK"
  | "CAMERA_OFF"
  | "CLOCK_OFF"
  | "LOW_STORAGE"
  | "DIRTY_BUILD";

/** No check-in for this long: the app is closed, the tablet is off, or offline. */
export const SILENT_MS = 15 * 60 * 1000;
/** A scan waiting longer than this to go out is stuck, not queued. */
export const QUEUE_STUCK_SEC = 10 * 60;
/** Further from this server's clock than this, and scan times are wrong. */
export const CLOCK_SKEW_SEC = 120;
export const LOW_STORAGE_MB = 500;

/**
 * What about a tablet needs someone, most urgent first. Empty when nothing
 * does. A silent tablet's other figures are from its last check-in, so they
 * still say how it was when it went quiet.
 */
export function deviceAlerts(d: AlertInput, now: Date): DeviceAlert[] {
  const alerts: DeviceAlert[] = [];
  if (now.getTime() - d.lastSeenAt.getTime() > SILENT_MS) alerts.push("SILENT");
  if (d.plugged === "NONE") alerts.push("UNPLUGGED");
  if (d.oldestPendingSec !== null && d.oldestPendingSec > QUEUE_STUCK_SEC) alerts.push("QUEUE_STUCK");
  if (d.cameraPermission === false) alerts.push("CAMERA_OFF");
  if (d.autoTime === false || (d.clockSkewSec !== null && Math.abs(d.clockSkewSec) > CLOCK_SKEW_SEC)) {
    alerts.push("CLOCK_OFF");
  }
  if (d.dataFreeMb !== null && d.dataFreeMb < LOW_STORAGE_MB) alerts.push("LOW_STORAGE");
  if (d.gitDirty === true) alerts.push("DIRTY_BUILD");
  return alerts;
}
