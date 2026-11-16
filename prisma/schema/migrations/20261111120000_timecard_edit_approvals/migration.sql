-- Supervisor timecard edits that wait for HR (prisma/schema/timecard-edit.prisma,
-- src/lib/timecards/supervisor-edits.ts).
--
-- Additive: one site column, off everywhere, and two new tables. Nothing
-- existing changes, and the code before this one never reads any of it. Written
-- to run more than once, so it is a no-op where it was applied ahead of the
-- deploy.
--
-- Undo (drops every pending and decided request):
--   DROP TABLE IF EXISTS "timecard_edit_items";
--   DROP TABLE IF EXISTS "timecard_edit_requests";
--   DROP TYPE IF EXISTS "TimecardEditItemStatus";
--   DROP TYPE IF EXISTS "TimecardEditKind";
--   DROP TYPE IF EXISTS "TimecardEditStatus";
--   ALTER TABLE "sites" DROP COLUMN IF EXISTS "supervisorTimecardEdits";

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "supervisorTimecardEdits" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  CREATE TYPE "TimecardEditStatus" AS ENUM ('PENDING', 'DECIDED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TimecardEditKind" AS ENUM ('ADD_PUNCH', 'CHANGE_PUNCH', 'REMOVE_PUNCH', 'ADD_PAIR', 'ADD_HOURS', 'MEAL_WAIVER', 'APPROVE_REQUEST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TimecardEditItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "timecard_edit_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TimecardEditStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timecard_edit_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "timecard_edit_items" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "TimecardEditKind" NOT NULL,
    "punchId" TEXT,
    "exceptionId" TEXT,
    "punchType" TEXT,
    "at" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "before" TIMESTAMP(3),
    "day" DATE NOT NULL,
    "minutes" INTEGER,
    "waive" BOOLEAN,
    "status" "TimecardEditItemStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timecard_edit_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "timecard_edit_requests_tenantId_status_idx" ON "timecard_edit_requests"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "timecard_edit_requests_timesheetId_status_idx" ON "timecard_edit_requests"("timesheetId", "status");
CREATE INDEX IF NOT EXISTS "timecard_edit_items_requestId_idx" ON "timecard_edit_items"("requestId");
CREATE INDEX IF NOT EXISTS "timecard_edit_items_punchId_idx" ON "timecard_edit_items"("punchId");

DO $$
BEGIN
  ALTER TABLE "timecard_edit_requests" ADD CONSTRAINT "timecard_edit_requests_timesheetId_fkey"
      FOREIGN KEY ("timesheetId") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "timecard_edit_requests" ADD CONSTRAINT "timecard_edit_requests_submittedById_fkey"
      FOREIGN KEY ("submittedById") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "timecard_edit_items" ADD CONSTRAINT "timecard_edit_items_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "timecard_edit_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables). CloudTime connects as the owner, which
-- row level security does not bind.
ALTER TABLE "timecard_edit_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timecard_edit_items" ENABLE ROW LEVEL SECURITY;
