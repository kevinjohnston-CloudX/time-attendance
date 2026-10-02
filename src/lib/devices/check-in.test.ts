import { describe, expect, it } from "vitest";
import {
  ALIVE_MS,
  chooseDevice,
  clockSkewSec,
  deviceAlerts,
  hasIdentity,
  installChanged,
  readReport,
  type AlertInput,
  type DeviceCandidate,
} from "./check-in";

const INSTALL = "93bca374-a153-4639-ae70-e4a8e881f32a";
const OTHER_INSTALL = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const NOW = new Date("2026-10-02T00:11:12.000Z");

/** The check-in the test tablet (NJ3-DOCK-A-CRTEST) sent on 2026-10-01, trimmed. */
const TEST_TABLET = {
  InstallId: INSTALL,
  DeviceTime: "2026-10-01T20:11:11.702-04:00",
  identity: {
    AndroidId: "0750de79a0aa4b8d",
    IsDeviceOwner: false,
    SerialError: "NEEDS_DEVICE_OWNER_OR_PERMISSION",
    Manufacturer: "LENOVO",
    Model: "TB330FU",
    AndroidVersion: "15",
    Sdk: 35,
  },
  build: { AppVersion: "163", VersionCode: 163, GitSha: "90a5fc67cf7a", GitDirty: false },
  setup: { DeviceName: "NJ3-DOCK-A-CRTEST", Warehouse: 5, WarehouseName: "NJ3", Stream: "SECURITY" },
  power: { BatteryPct: 77, Charging: true, Plugged: "AC", BatteryTempC: 33.5 },
  network: { Type: "WIFI", Connected: true, WifiRssi: -50 },
  queue: { Pending: 0, FailedPermanent: 12, CloudTimeBacklog: 0 },
  storage: { DataFreeBytes: 31285665792, DataTotalBytes: 49344905216 },
  health: { AutoTime: true, CameraPermission: true, Screen: "MainActivity" },
  CheckInSeq: 1,
};

function candidate(id: string, installId: string | null, lastSeenAgoMs: number): DeviceCandidate {
  return { id, installId, lastSeenAt: new Date(NOW.getTime() - lastSeenAgoMs) };
}

describe("readReport", () => {
  it("reads a real check-in", () => {
    const r = readReport(TEST_TABLET);
    expect(r.installId).toBe(INSTALL);
    expect(r.androidId).toBe("0750de79a0aa4b8d");
    expect(r.hardwareSerial).toBeNull();
    expect(r.model).toBe("TB330FU");
    expect(r.appVersion).toBe("163");
    expect(r.gitDirty).toBe(false);
    expect(r.deviceName).toBe("NJ3-DOCK-A-CRTEST");
    expect(r.warehouse).toBe(5);
    expect(r.stream).toBe("SECURITY");
    expect(r.batteryPct).toBe(77);
    expect(r.plugged).toBe("AC");
    expect(r.wifiRssi).toBe(-50);
    expect(r.queueFailed).toBe(12);
    expect(r.dataFreeMb).toBe(29836);
    expect(r.cameraPermission).toBe(true);
    expect(r.screen).toBe("MainActivity");
    expect(r.deviceTime?.toISOString()).toBe("2026-10-02T00:11:11.702Z");
    expect(clockSkewSec(r, NOW)).toBe(0);
  });

  it("treats every field of the wrong type as unknown", () => {
    const r = readReport({
      InstallId: "not-a-uuid",
      DeviceTime: "yesterday-ish",
      identity: { AndroidId: 7, AssetTag: "  cx-0042 ", WifiMac: "AA:BB:CC:DD:EE:FF" },
      setup: { Warehouse: "13" },
      power: { BatteryPct: "77", Charging: "yes" },
      storage: { DataFreeBytes: -1 },
      queue: { Pending: 1e12 },
      health: "broken",
    });
    expect(r.installId).toBeNull();
    expect(r.deviceTime).toBeNull();
    expect(r.androidId).toBeNull();
    expect(r.assetTag).toBe("CX-0042");
    expect(r.wifiMac).toBe("aa:bb:cc:dd:ee:ff");
    expect(r.warehouse).toBeNull();
    expect(r.batteryPct).toBeNull();
    expect(r.charging).toBeNull();
    expect(r.dataFreeMb).toBeNull();
    expect(r.queuePending).toBeNull();
    expect(r.cameraPermission).toBeNull();
    expect(hasIdentity(r)).toBe(true);
  });

  it("needs at least one identity", () => {
    expect(hasIdentity(readReport(null))).toBe(false);
    expect(hasIdentity(readReport([1, 2]))).toBe(false);
    expect(hasIdentity(readReport({ setup: { DeviceName: "x" } }))).toBe(false);
  });

  it("bounds strings to their columns", () => {
    const r = readReport({ InstallId: INSTALL, setup: { DeviceName: "x".repeat(500) } });
    expect(r.deviceName).toHaveLength(100);
  });
});

describe("chooseDevice", () => {
  const report = readReport({
    InstallId: INSTALL,
    identity: { HardwareSerial: "HA24TD9M", AndroidId: "0750de79a0aa4b8d", AssetTag: "CX-1" },
  });

  it("is a new tablet when nothing matches", () => {
    expect(chooseDevice(report, {}, NOW)).toEqual({ device: null, by: null, tagInUse: false });
  });

  it("prefers the install id over everything", () => {
    const a = candidate("a", INSTALL, 0);
    const b = candidate("b", OTHER_INSTALL, 0);
    const choice = chooseDevice(report, { installId: a, hardwareSerial: b, assetTag: b }, NOW);
    expect(choice.device?.id).toBe("a");
    expect(choice.by).toBe("installId");
  });

  it("keeps a reset tablet's row by its serial, and says the install changed", () => {
    const old = candidate("old", OTHER_INSTALL, 3 * 3600_000);
    const choice = chooseDevice(report, { hardwareSerial: old, androidId: old }, NOW);
    expect(choice.device?.id).toBe("old");
    expect(choice.by).toBe("hardwareSerial");
    expect(installChanged(old, report)).toBe(true);
  });

  it("matches by Android id when the serial is unreadable", () => {
    const noSerial = readReport({ InstallId: INSTALL, identity: { AndroidId: "0750de79a0aa4b8d" } });
    const old = candidate("old", OTHER_INSTALL, 60_000);
    expect(chooseDevice(noSerial, { androidId: old }, NOW).by).toBe("androidId");
  });

  it("takes an asset tag from a tablet that went quiet", () => {
    const tagOnly = readReport({ InstallId: INSTALL, identity: { AssetTag: "CX-1" } });
    const quiet = candidate("quiet", OTHER_INSTALL, ALIVE_MS + 1000);
    const choice = chooseDevice(tagOnly, { assetTag: quiet }, NOW);
    expect(choice.device?.id).toBe("quiet");
    expect(choice.tagInUse).toBe(false);
  });

  it("refuses an asset tag a running tablet already has", () => {
    const tagOnly = readReport({ InstallId: INSTALL, identity: { AssetTag: "CX-1" } });
    const running = candidate("running", OTHER_INSTALL, 60_000);
    expect(chooseDevice(tagOnly, { assetTag: running }, NOW)).toEqual({ device: null, by: null, tagInUse: true });
  });

  it("does not count a check-in without an install id as a new install", () => {
    const noInstall = readReport({ identity: { HardwareSerial: "HA24TD9M" } });
    expect(installChanged(candidate("x", INSTALL, 0), noInstall)).toBe(false);
  });
});

describe("deviceAlerts", () => {
  const healthy: AlertInput = {
    lastSeenAt: new Date(NOW.getTime() - 60_000),
    plugged: "AC",
    oldestPendingSec: null,
    cameraPermission: true,
    autoTime: true,
    clockSkewSec: 1,
    dataFreeMb: 29836,
    gitDirty: false,
  };

  it("has nothing to say about a healthy tablet", () => {
    expect(deviceAlerts(healthy, NOW)).toEqual([]);
  });

  it("says every problem, most urgent first", () => {
    expect(
      deviceAlerts(
        {
          lastSeenAt: new Date(NOW.getTime() - 16 * 60_000),
          plugged: "NONE",
          oldestPendingSec: 601,
          cameraPermission: false,
          autoTime: true,
          clockSkewSec: -300,
          dataFreeMb: 100,
          gitDirty: true,
        },
        NOW,
      ),
    ).toEqual(["SILENT", "UNPLUGGED", "QUEUE_STUCK", "CAMERA_OFF", "CLOCK_OFF", "LOW_STORAGE", "DIRTY_BUILD"]);
  });

  it("reads automatic time switched off as a clock problem", () => {
    expect(deviceAlerts({ ...healthy, autoTime: false }, NOW)).toEqual(["CLOCK_OFF"]);
  });
});
