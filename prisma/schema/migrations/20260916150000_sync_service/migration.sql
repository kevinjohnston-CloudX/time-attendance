-- Oracle sync via the WMS bridge: job queue, run log, roster staging, and the
-- per-day schedule.
--
-- Purely additive. Five new enums and five new tables; nothing existing is
-- altered or dropped.
--
-- NOTE ON PROVENANCE: generated with `prisma migrate diff
-- --from-config-datasource --to-schema`, then filtered. The raw diff also
-- proposed dropping `password_reset_tokens` and `users.mustChangePassword`,
-- which exist in the live database but not in this schema. That is
-- pre-existing drift unrelated to this change and those statements were
-- deliberately removed -- running the unfiltered diff would destroy a live
-- feature.
--
-- schedule_days is the first per-day schedule CloudTime has had (Shift is a
-- recurring definition, not an assignment). It syncs one way only: the bridge
-- reaches a read-only Oracle standby, so a CloudTime-side edit is marked
-- LOCAL_EDIT and lives only here.

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('ROSTER', 'SCHEDULE_PULL');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ScheduleSource" AS ENUM ('ORACLE', 'CLOUDTIME');

-- CreateEnum
CREATE TYPE "ScheduleSyncState" AS ENUM ('SYNCED', 'LOCAL_EDIT', 'CONFLICT');

-- CreateEnum
CREATE TYPE "RosterCandidateStatus" AS ENUM ('NEW', 'IGNORED', 'RESOLVED');

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "received" INTEGER NOT NULL DEFAULT 0,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB,
    "agent" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_candidates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "oracleEmpId" TEXT NOT NULL,
    "oracleUsersId" TEXT,
    "barcode" TEXT,
    "name" TEXT,
    "departmentName" TEXT,
    "siteName" TEXT,
    "isActiveInOracle" BOOLEAN NOT NULL DEFAULT true,
    "status" "RosterCandidateStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "failedScans" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "roster_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_days" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "shiftId" TEXT,
    "isWorkday" BOOLEAN NOT NULL DEFAULT true,
    "startTime" TEXT,
    "endTime" TEXT,
    "mealMinutes" INTEGER,
    "oracleScheduleId" TEXT,
    "oracleUsersId" TEXT,
    "source" "ScheduleSource" NOT NULL DEFAULT 'ORACLE',
    "syncState" "ScheduleSyncState" NOT NULL DEFAULT 'SYNCED',
    "oracleFingerprint" TEXT,
    "oracleSyncedAt" TIMESTAMP(3),
    "conflictNote" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "syncRunId" TEXT,

    CONSTRAINT "bridge_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "version" TEXT,

    CONSTRAINT "bridge_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_runs_tenantId_kind_startedAt_idx" ON "sync_runs"("tenantId", "kind", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "roster_candidates_tenantId_status_failedScans_idx" ON "roster_candidates"("tenantId", "status", "failedScans" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "roster_candidates_tenantId_oracleEmpId_key" ON "roster_candidates"("tenantId", "oracleEmpId");

-- CreateIndex
CREATE INDEX "schedule_days_tenantId_workDate_idx" ON "schedule_days"("tenantId", "workDate");

-- CreateIndex
CREATE INDEX "schedule_days_tenantId_syncState_updatedAt_idx" ON "schedule_days"("tenantId", "syncState", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_days_employeeId_workDate_key" ON "schedule_days"("employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_days_oracleScheduleId_key" ON "schedule_days"("oracleScheduleId");

-- CreateIndex
CREATE INDEX "bridge_jobs_status_kind_createdAt_idx" ON "bridge_jobs"("status", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "bridge_jobs_tenantId_kind_createdAt_idx" ON "bridge_jobs"("tenantId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bridge_agents_name_key" ON "bridge_agents"("name");

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_candidates" ADD CONSTRAINT "roster_candidates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_days" ADD CONSTRAINT "schedule_days_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_days" ADD CONSTRAINT "schedule_days_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_days" ADD CONSTRAINT "schedule_days_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_jobs" ADD CONSTRAINT "bridge_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

