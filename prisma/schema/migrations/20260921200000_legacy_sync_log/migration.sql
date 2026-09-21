-- Every attempt a tablet makes to write to Oracle, and how it ended.
--
-- CloudTime cannot reach Oracle: the bridge talks to a read-only standby, so
-- the tablet is the only thing that writes a punch there. While Oracle answered
-- in front of the employee a refusal was self-reporting -- the person was
-- standing at the tablet. Once the time clock started deciding in CloudTime and
-- writing to Oracle behind them, a refusal became a queue row on one device
-- that nobody sees until a shift is missing from a timecard.

-- CreateEnum
CREATE TYPE "LegacySyncKind" AS ENUM ('PUNCH', 'GATE_SCAN', 'CAPTURE');

-- CreateEnum
CREATE TYPE "LegacySyncOutcome" AS ENUM ('SUCCESS', 'REFUSED', 'RETRYING', 'FAILED_PERMANENT');

-- CreateTable
CREATE TABLE "legacy_sync_logs" (
    "id" TEXT NOT NULL,
    "badgeCode" TEXT NOT NULL,
    "kind" "LegacySyncKind" NOT NULL,
    "outcome" "LegacySyncOutcome" NOT NULL,
    "scanTime" TIMESTAMP(3) NOT NULL,
    "endpoint" TEXT,
    "message" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "queueRowId" INTEGER,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_sync_logs_pkey" PRIMARY KEY ("id")
);

-- One row per attempt per queue row, so a tablet re-posting a report it is
-- unsure landed writes the same row rather than a second one.
-- CreateIndex
CREATE UNIQUE INDEX "legacy_sync_logs_deviceName_queueRowId_attemptCount_key"
    ON "legacy_sync_logs"("deviceName", "queueRowId", "attemptCount");

-- The query this table exists to answer: what has failed, most recent first.
-- CreateIndex
CREATE INDEX "legacy_sync_logs_outcome_createdAt_idx"
    ON "legacy_sync_logs"("outcome", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "legacy_sync_logs_badgeCode_scanTime_idx"
    ON "legacy_sync_logs"("badgeCode", "scanTime");

-- AddForeignKey
ALTER TABLE "legacy_sync_logs" ADD CONSTRAINT "legacy_sync_logs_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
