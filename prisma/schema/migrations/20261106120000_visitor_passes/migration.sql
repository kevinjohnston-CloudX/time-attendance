-- Visitor passes: how long a visitor's badge opens the gate, and at which
-- building (prisma/schema/visitor.prisma, src/lib/visitors/visitor-pass.ts).
--
-- Additive: one new table, nothing existing changes. A visitor badge with no
-- pass keeps working exactly as before. Written to run more than once, so it
-- is a no-op where it was applied ahead of the deploy.
--
-- Undo (removes every pass; visitors fall back to badges with no end date):
--   DROP TABLE IF EXISTS "visitor_passes";

CREATE TABLE IF NOT EXISTS "visitor_passes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "company" TEXT,
    "hostEmployeeId" TEXT,
    "hostName" TEXT,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "createdById" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitor_passes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "visitor_passes_employeeId_key" ON "visitor_passes"("employeeId");
CREATE INDEX IF NOT EXISTS "visitor_passes_tenantId_siteId_validUntil_idx" ON "visitor_passes"("tenantId", "siteId", "validUntil");
CREATE INDEX IF NOT EXISTS "visitor_passes_hostEmployeeId_idx" ON "visitor_passes"("hostEmployeeId");

DO $$
BEGIN
  ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_hostEmployeeId_fkey"
      FOREIGN KEY ("hostEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables). CloudTime connects as the owner, which
-- row level security does not bind.
ALTER TABLE "visitor_passes" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "visitor_passes" FROM anon, authenticated;
