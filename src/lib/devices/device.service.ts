import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  chooseDevice,
  clockSkewSec,
  deviceAlerts,
  installChanged,
  MATCH_ORDER,
  type DeviceAlert,
  type DeviceCandidate,
  type DeviceReport,
  type MatchKey,
} from "./check-in";

/**
 * The tablets: one row per physical tablet (devices), kept current by its
 * check-ins, with a trimmed history (device_check_ins). The rules are in
 * check-in.ts; this file only reads and writes.
 */

/** How long a check-in's history row is kept. */
const HISTORY_DAYS = 30;

export interface CheckInResult {
  deviceId: string;
  created: boolean;
  matchedBy: MatchKey | null;
  installChanged: boolean;
  tagInUse: boolean;
}

/**
 * Stores one check-in: matches it to its tablet (or makes a new one), brings
 * that tablet's row up to date, adds the history row and drops this tablet's
 * history older than {@link HISTORY_DAYS}.
 *
 * @param raw the body as received, kept whole as the tablet's lastReport
 */
export async function recordCheckIn(
  report: DeviceReport,
  raw: Prisma.InputJsonValue,
  receivedAt: Date,
): Promise<CheckInResult> {
  // Every stored tablet that shares any id with this check-in. Usually one row,
  // never more than a handful: the ids are per tablet.
  const or: Prisma.DeviceWhereInput[] = [];
  if (report.installId) or.push({ installId: report.installId });
  if (report.hardwareSerial) or.push({ hardwareSerial: report.hardwareSerial });
  if (report.wifiMac) or.push({ wifiMac: report.wifiMac });
  if (report.androidId) or.push({ androidId: report.androidId });
  if (report.assetTag) or.push({ assetTag: report.assetTag });
  if (or.length === 0) throw new Error("recordCheckIn: the check-in names no identity");
  const rows = await db.device.findMany({
    where: { OR: or },
    select: {
      id: true,
      installId: true,
      lastSeenAt: true,
      hardwareSerial: true,
      wifiMac: true,
      androidId: true,
      assetTag: true,
    },
    orderBy: { lastSeenAt: "desc" },
    take: 10,
  });
  const found: Partial<Record<MatchKey, DeviceCandidate>> = {};
  for (const key of MATCH_ORDER) {
    const row = report[key] === null ? undefined : rows.find((r) => r[key] === report[key]);
    if (row) found[key] = { id: row.id, installId: row.installId, lastSeenAt: row.lastSeenAt };
  }
  const choice = chooseDevice(report, found, receivedAt);

  // The building, the way every scan names it: the tablet's warehouse number.
  const site =
    report.warehouse === null
      ? null
      : await db.site.findFirst({
          where: { wmsWarehouseId: report.warehouse },
          select: { id: true, tenantId: true },
        });

  const skew = clockSkewSec(report, receivedAt);
  const latest = {
    tenantId: site?.tenantId ?? null,
    siteId: site?.id ?? null,
    androidId: report.androidId,
    hardwareSerial: report.hardwareSerial,
    wifiMac: report.wifiMac,
    assetTag: report.assetTag,
    deviceName: report.deviceName,
    warehouse: report.warehouse,
    stream: report.stream,
    manufacturer: report.manufacturer,
    model: report.model,
    androidVersion: report.androidVersion,
    appVersion: report.appVersion,
    gitSha: report.gitSha,
    gitDirty: report.gitDirty,
    isDeviceOwner: report.isDeviceOwner,
    batteryPct: report.batteryPct,
    charging: report.charging,
    plugged: report.plugged,
    networkType: report.networkType,
    wifiRssi: report.wifiRssi,
    queuePending: report.queuePending,
    queueFailed: report.queueFailed,
    oldestPendingSec: report.oldestPendingSec,
    dataFreeMb: report.dataFreeMb,
    cameraPermission: report.cameraPermission,
    autoTime: report.autoTime,
    screen: report.screen,
    clockSkewSec: skew,
    lastReport: raw,
    lastSeenAt: receivedAt,
  };
  const history = {
    receivedAt,
    installId: report.installId,
    appVersion: report.appVersion,
    batteryPct: report.batteryPct,
    charging: report.charging,
    plugged: report.plugged,
    networkType: report.networkType,
    wifiRssi: report.wifiRssi,
    queuePending: report.queuePending,
    queueFailed: report.queueFailed,
    oldestPendingSec: report.oldestPendingSec,
    dataFreeMb: report.dataFreeMb,
    screen: report.screen,
    clockSkewSec: skew,
  };

  const stored = choice.device;
  const changed = stored !== null && installChanged(stored, report);
  let deviceId: string;
  let created = false;

  if (stored) {
    // A new install id on a tablet already on file: a reinstall or a reset.
    // A check-in with no install id keeps the one on file.
    const install = report.installId ?? stored.installId;
    await db.device.update({
      where: { id: stored.id },
      data: {
        ...latest,
        installId: install,
        checkIns: { increment: 1 },
        ...(changed
          ? { installChanges: { increment: 1 }, previousInstallId: stored.installId, installChangedAt: receivedAt }
          : {}),
      },
    });
    deviceId = stored.id;
  } else if (report.installId) {
    // Upsert, not create: two check-ins of a brand new install can land at once,
    // and the second then updates the row the first made.
    const row = await db.device.upsert({
      where: { installId: report.installId },
      create: { ...latest, installId: report.installId, checkIns: 1, firstSeenAt: receivedAt },
      update: { ...latest, checkIns: { increment: 1 } },
      select: { id: true },
    });
    deviceId = row.id;
    created = true;
  } else {
    const row = await db.device.create({
      data: { ...latest, installId: null, checkIns: 1, firstSeenAt: receivedAt },
      select: { id: true },
    });
    deviceId = row.id;
    created = true;
  }

  await db.$transaction([
    db.deviceCheckIn.create({ data: { deviceId, ...history } }),
    db.deviceCheckIn.deleteMany({
      where: { deviceId, receivedAt: { lt: new Date(receivedAt.getTime() - HISTORY_DAYS * 86_400_000) } },
    }),
  ]);

  return { deviceId, created, matchedBy: choice.by, installChanged: changed, tagInUse: choice.tagInUse };
}

/** A tablet as a Devices page shows it: its row without the raw report, and its alerts. */
export type DeviceRow = Omit<Prisma.DeviceGetPayload<{ include: { site: { select: { name: true } } } }>, "lastReport"> & {
  alerts: DeviceAlert[];
};

/**
 * The tablets, most recently seen first, each with its alerts. For a Devices
 * page (not built yet) and for reports. Filtered to a tenant and optionally
 * one building.
 */
export async function listDevices(filter: { tenantId: string; siteId?: string }, now = new Date()): Promise<DeviceRow[]> {
  const rows = await db.device.findMany({
    where: { tenantId: filter.tenantId, ...(filter.siteId ? { siteId: filter.siteId } : {}) },
    omit: { lastReport: true },
    include: { site: { select: { name: true } } },
    orderBy: { lastSeenAt: "desc" },
  });
  return rows.map((row) => ({ ...row, alerts: deviceAlerts(row, now) }));
}
