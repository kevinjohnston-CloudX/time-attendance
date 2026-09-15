-- CreateEnum
CREATE TYPE "ScanStream" AS ENUM ('TIME_CLOCK', 'SECURITY');

-- CreateEnum
CREATE TYPE "ScanDirection" AS ENUM ('IN', 'OUT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "scan_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "employeeId" TEXT,
    "badgeCode" TEXT NOT NULL,
    "stream" "ScanStream" NOT NULL,
    "direction" "ScanDirection" NOT NULL DEFAULT 'UNKNOWN',
    "scanTime" TIMESTAMP(3) NOT NULL,
    "deviceName" TEXT,
    "warehouse" INTEGER,
    "punchId" TEXT,
    "legacyScanType" TEXT,
    "legacyMismatch" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scan_events_punchId_key" ON "scan_events"("punchId");

-- CreateIndex
-- Makes a retried post idempotent: the kiosk queue re-sends a scan until the
-- server accepts it, and a duplicate must not toggle the gate direction twice.
CREATE UNIQUE INDEX "scan_events_badgeCode_stream_scanTime_key" ON "scan_events"("badgeCode", "stream", "scanTime");

-- CreateIndex
CREATE INDEX "scan_events_employeeId_stream_scanTime_idx" ON "scan_events"("employeeId", "stream", "scanTime" DESC);

-- CreateIndex
CREATE INDEX "scan_events_tenantId_stream_scanTime_idx" ON "scan_events"("tenantId", "stream", "scanTime" DESC);

-- CreateIndex
CREATE INDEX "scan_events_badgeCode_scanTime_idx" ON "scan_events"("badgeCode", "scanTime" DESC);

-- AddForeignKey
-- SET NULL, not CASCADE: deleting an employee must never silently delete the
-- record that they badged through a gate.
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_punchId_fkey" FOREIGN KEY ("punchId") REFERENCES "punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
