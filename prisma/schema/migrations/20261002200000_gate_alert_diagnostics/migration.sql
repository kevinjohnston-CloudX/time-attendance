-- Diagnostics for the Live Attendance gate alert, so a pop up that did not
-- appear can be traced to the second: every try the gate turned away
-- (gate_refusal_tries), every time a card appeared on a screen and how it went
-- away (gate_refusal_views), and which building each open Live Attendance
-- page was on and whether it was in front (live_attendance_watches).
--
-- Additive: three new tables, nothing existing changes. Safe to run more than
-- once, so it is a no-op where it was applied ahead of the deploy.
-- Undo:
--   DROP TABLE IF EXISTS "gate_refusal_tries";
--   DROP TABLE IF EXISTS "gate_refusal_views";
--   DROP TABLE IF EXISTS "live_attendance_watches";

CREATE TABLE IF NOT EXISTS "gate_refusal_tries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "refusalId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceName" TEXT,
    "warehouse" TEXT,
    "placedBy" TEXT NOT NULL,
    "params" TEXT,
    "alertsOn" BOOLEAN NOT NULL,
    "dismissed" BOOLEAN NOT NULL,
    "attempt" INTEGER NOT NULL,
    CONSTRAINT "gate_refusal_tries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gate_refusal_views" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "refusalId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "employeeId" TEXT,
    "screenId" TEXT NOT NULL,
    "refusalLastAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visible" BOOLEAN NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedHow" TEXT,
    CONSTRAINT "gate_refusal_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "live_attendance_watches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,
    "employeeId" TEXT,
    "siteId" TEXT NOT NULL,
    "alerts" BOOLEAN NOT NULL,
    "visible" BOOLEAN NOT NULL,
    "focused" BOOLEAN NOT NULL,
    "deployId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pulsesOk" INTEGER NOT NULL DEFAULT 0,
    "pulsesFailed" INTEGER NOT NULL DEFAULT 0,
    "lastPulseOkAt" TIMESTAMP(3),
    "lastPulseError" TEXT,
    "lastAlertCheckAt" TIMESTAMP(3),
    "alertCards" INTEGER,
    "lastAlertCheckError" TEXT,
    CONSTRAINT "live_attendance_watches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gate_refusal_tries_refusalId_idx" ON "gate_refusal_tries"("refusalId");
CREATE INDEX IF NOT EXISTS "gate_refusal_tries_tenantId_at_idx" ON "gate_refusal_tries"("tenantId", "at");
CREATE INDEX IF NOT EXISTS "gate_refusal_views_refusalId_idx" ON "gate_refusal_views"("refusalId");
CREATE INDEX IF NOT EXISTS "gate_refusal_views_tenantId_siteId_shownAt_idx" ON "gate_refusal_views"("tenantId", "siteId", "shownAt");
CREATE INDEX IF NOT EXISTS "live_attendance_watches_tenantId_siteId_lastBeatAt_idx" ON "live_attendance_watches"("tenantId", "siteId", "lastBeatAt");
CREATE INDEX IF NOT EXISTS "live_attendance_watches_screenId_idx" ON "live_attendance_watches"("screenId");

DO $$
BEGIN
  ALTER TABLE "gate_refusal_tries" ADD CONSTRAINT "gate_refusal_tries_refusalId_fkey"
      FOREIGN KEY ("refusalId") REFERENCES "gate_refusals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "gate_refusal_views" ADD CONSTRAINT "gate_refusal_views_refusalId_fkey"
      FOREIGN KEY ("refusalId") REFERENCES "gate_refusals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables). CloudTime connects as the owner, which
-- row level security does not bind.
ALTER TABLE "gate_refusal_tries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gate_refusal_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "live_attendance_watches" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "gate_refusal_tries" FROM anon, authenticated;
REVOKE ALL ON "gate_refusal_views" FROM anon, authenticated;
REVOKE ALL ON "live_attendance_watches" FROM anon, authenticated;
