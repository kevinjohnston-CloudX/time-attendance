-- The tablets, as their own check-ins describe them: build 163 posts to
-- /api/timeclock/device-checkin every five minutes with its identity (install
-- id, Android id, hardware serial, Wi-Fi MAC, asset tag), build, setup, battery,
-- network, queue, storage and health. One row per physical tablet in
-- "devices", and a trimmed row per check-in in "device_check_ins" (30 days).
--
-- Additive: two new tables, nothing existing changes. Written to run more than
-- once, so it is a no-op where it was applied ahead of the deploy.
--
-- Undo: DROP TABLE IF EXISTS "device_check_ins"; DROP TABLE IF EXISTS "devices";

CREATE TABLE IF NOT EXISTS "devices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "siteId" TEXT,
    "installId" TEXT,
    "androidId" TEXT,
    "hardwareSerial" TEXT,
    "wifiMac" TEXT,
    "assetTag" TEXT,
    "deviceName" TEXT,
    "warehouse" INTEGER,
    "stream" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "androidVersion" TEXT,
    "appVersion" TEXT,
    "gitSha" TEXT,
    "gitDirty" BOOLEAN,
    "isDeviceOwner" BOOLEAN,
    "batteryPct" INTEGER,
    "charging" BOOLEAN,
    "plugged" TEXT,
    "networkType" TEXT,
    "wifiRssi" INTEGER,
    "queuePending" INTEGER,
    "queueFailed" INTEGER,
    "oldestPendingSec" INTEGER,
    "dataFreeMb" INTEGER,
    "cameraPermission" BOOLEAN,
    "autoTime" BOOLEAN,
    "screen" TEXT,
    "clockSkewSec" INTEGER,
    "lastReport" JSONB,
    "installChanges" INTEGER NOT NULL DEFAULT 0,
    "previousInstallId" TEXT,
    "installChangedAt" TIMESTAMP(3),
    "checkIns" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "device_check_ins" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installId" TEXT,
    "appVersion" TEXT,
    "batteryPct" INTEGER,
    "charging" BOOLEAN,
    "plugged" TEXT,
    "networkType" TEXT,
    "wifiRssi" INTEGER,
    "queuePending" INTEGER,
    "queueFailed" INTEGER,
    "oldestPendingSec" INTEGER,
    "dataFreeMb" INTEGER,
    "screen" TEXT,
    "clockSkewSec" INTEGER,

    CONSTRAINT "device_check_ins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "devices_installId_key" ON "devices"("installId");
CREATE INDEX IF NOT EXISTS "devices_hardwareSerial_idx" ON "devices"("hardwareSerial");
CREATE INDEX IF NOT EXISTS "devices_wifiMac_idx" ON "devices"("wifiMac");
CREATE INDEX IF NOT EXISTS "devices_androidId_idx" ON "devices"("androidId");
CREATE INDEX IF NOT EXISTS "devices_assetTag_idx" ON "devices"("assetTag");
CREATE INDEX IF NOT EXISTS "devices_siteId_lastSeenAt_idx" ON "devices"("siteId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "device_check_ins_deviceId_receivedAt_idx" ON "device_check_ins"("deviceId", "receivedAt");

DO $$
BEGIN
  ALTER TABLE "devices" ADD CONSTRAINT "devices_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "device_check_ins" ADD CONSTRAINT "device_check_ins_deviceId_fkey"
      FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables). CloudTime connects as the owner, which
-- row level security does not bind.
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_check_ins" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "devices" FROM anon, authenticated;
REVOKE ALL ON "device_check_ins" FROM anon, authenticated;
