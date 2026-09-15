-- Makes scan_events an independent record of tablet activity rather than a
-- mirror of the timecard pipeline's conclusions.
--
-- Additive: one new enum, four new columns on scan_events, one new value on
-- ExceptionType, one index. Nothing existing is dropped or narrowed, and the
-- punches / timesheets / work_segments tables are untouched.

-- CreateEnum
CREATE TYPE "ScanOutcome" AS ENUM (
    'PENDING',
    'PUNCH_RECORDED',
    'PUNCH_REJECTED',
    'NO_EMPLOYEE',
    'ERROR',
    'NOT_APPLICABLE'
);

-- AlterEnum
ALTER TYPE "ExceptionType" ADD VALUE 'SCAN_DISCREPANCY';

-- AlterTable
ALTER TABLE "scan_events"
    ADD COLUMN "outcome"            "ScanOutcome" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "rejectionReason"    TEXT,
    ADD COLUMN "timecardPunchType"  TEXT,
    ADD COLUMN "timecardStateAfter" TEXT;

-- Backfill: rows written by the previous design only ever existed when a punch
-- succeeded, so every one of them is a recorded punch. Gate scans never enter
-- the timecard pipeline at all.
UPDATE "scan_events" SET "outcome" = 'PUNCH_RECORDED'
WHERE  "stream" = 'TIME_CLOCK' AND "punchId" IS NOT NULL;

UPDATE "scan_events" SET "outcome" = 'NOT_APPLICABLE'
WHERE  "stream" = 'SECURITY';

-- Backfill what the timecard concluded, so existing rows are comparable too.
UPDATE "scan_events" s
SET    "timecardPunchType"  = p."punchType"::text,
       "timecardStateAfter" = p."stateAfter"::text
FROM   "punches" p
WHERE  s."punchId" = p."id";

-- CreateIndex
-- Drives the discrepancy sweep, which looks for anything that is not a clean
-- PUNCH_RECORDED inside a date window.
CREATE INDEX "scan_events_tenantId_outcome_scanTime_idx"
    ON "scan_events" ("tenantId", "outcome", "scanTime" DESC);
