-- Who CloudTime's gate check turned away for having no shift today, so Live
-- Attendance can alert loss prevention and let them add the person to today's
-- schedule. One row per person, per building, per day.
--
-- Additive: a new table, nothing existing changes. Written to run more than
-- once, so it is a no-op where it was applied ahead of the deploy.
--
-- Undo: DROP TABLE IF EXISTS "gate_refusals";

CREATE TABLE IF NOT EXISTS "gate_refusals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,
    "deviceName" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "scheduledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gate_refusals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gate_refusals_employeeId_siteId_workDate_key"
    ON "gate_refusals"("employeeId", "siteId", "workDate");

CREATE INDEX IF NOT EXISTS "gate_refusals_tenantId_siteId_workDate_idx"
    ON "gate_refusals"("tenantId", "siteId", "workDate");

DO $$
BEGIN
  ALTER TABLE "gate_refusals" ADD CONSTRAINT "gate_refusals_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "gate_refusals" ADD CONSTRAINT "gate_refusals_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables). CloudTime connects as the owner, which
-- row level security does not bind.
ALTER TABLE "gate_refusals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "gate_refusals" FROM anon, authenticated;
