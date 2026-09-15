-- scan_events — unified kiosk scan log for the Security gate and the Time Clock.
--
-- PURELY ADDITIVE. This script creates two enum types and one new table.
-- It does not ALTER, DROP or backfill anything that already exists, so the
-- punches / timesheets / work_segments tables that produce timecards are
-- untouched and keep behaving exactly as they do today.
--
-- Apply with either:
--   psql "$DIRECT_URL" -f prisma/sql/001_scan_events.sql
--   npx prisma db push          (after reviewing the diff it reports)
--
-- Safe to run against a live database: no locks are taken on existing tables
-- beyond the two foreign keys added below, which validate against employees
-- and punches. On a large punches table, consider adding those two constraints
-- separately with NOT VALID first if you need to avoid the validation scan.

BEGIN;

CREATE TYPE "ScanStream"    AS ENUM ('TIME_CLOCK', 'SECURITY');
CREATE TYPE "ScanDirection" AS ENUM ('IN', 'OUT', 'UNKNOWN');

CREATE TABLE "scan_events" (
    "id"             TEXT            NOT NULL,
    "tenantId"       TEXT,
    "employeeId"     TEXT,
    "badgeCode"      TEXT            NOT NULL,
    "stream"         "ScanStream"    NOT NULL,
    "direction"      "ScanDirection" NOT NULL DEFAULT 'UNKNOWN',
    "scanTime"       TIMESTAMP(3)    NOT NULL,
    "deviceName"     TEXT,
    "warehouse"      INTEGER,
    "punchId"        TEXT,
    "legacyScanType" TEXT,
    "legacyMismatch" BOOLEAN         NOT NULL DEFAULT false,
    "note"           TEXT,
    "createdAt"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

-- One scan row per punch, at most.
CREATE UNIQUE INDEX "scan_events_punchId_key"
    ON "scan_events" ("punchId");

-- Makes a retried post idempotent. The kiosk queue re-sends a scan until the
-- server accepts it; without this a retry would toggle the gate direction a
-- second time and invert the employee's day.
CREATE UNIQUE INDEX "scan_events_badgeCode_stream_scanTime_key"
    ON "scan_events" ("badgeCode", "stream", "scanTime");

-- Direction resolution reads the previous event in one stream, newest first.
CREATE INDEX "scan_events_employeeId_stream_scanTime_idx"
    ON "scan_events" ("employeeId", "stream", "scanTime" DESC);

-- "Who is on site" and per-tenant reporting.
CREATE INDEX "scan_events_tenantId_stream_scanTime_idx"
    ON "scan_events" ("tenantId", "stream", "scanTime" DESC);

-- Lookups for a badge that never matched an employee.
CREATE INDEX "scan_events_badgeCode_scanTime_idx"
    ON "scan_events" ("badgeCode", "scanTime" DESC);

-- SET NULL, not CASCADE: deleting an employee must never silently delete the
-- record that they badged through a gate.
ALTER TABLE "scan_events"
    ADD CONSTRAINT "scan_events_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scan_events"
    ADD CONSTRAINT "scan_events_punchId_fkey"
    FOREIGN KEY ("punchId") REFERENCES "punches"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
