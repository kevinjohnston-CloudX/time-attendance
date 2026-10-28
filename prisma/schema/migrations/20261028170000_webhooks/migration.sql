-- Webhooks: the web addresses another system gave a company, told the moment
-- someone is terminated or rehired (src/lib/webhooks). Three new tables: the
-- endpoints, the messages waiting to go, and every attempt to send one.
--
-- Additive: three new tables, nothing existing changes. No secret is stored
-- (see prisma/schema/webhook.prisma). Written to run more than once, so it is a
-- no-op where it was applied ahead of the deploy.
--
-- Undo (removes every endpoint and its history):
--   DROP TABLE IF EXISTS "webhook_deliveries"; DROP TABLE IF EXISTS "webhook_queue"; DROP TABLE IF EXISTS "webhook_endpoints";

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "keyCheck" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "webhook_queue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "employeeId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_queue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "queueId" TEXT,
    "event" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "ok" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "response" TEXT,
    "durationMs" INTEGER,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_endpoints_tenantId_idx" ON "webhook_endpoints"("tenantId");
CREATE INDEX IF NOT EXISTS "webhook_queue_status_nextAttemptAt_idx" ON "webhook_queue"("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "webhook_queue_endpointId_idx" ON "webhook_queue"("endpointId");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpointId_attemptedAt_idx" ON "webhook_deliveries"("endpointId", "attemptedAt");

DO $$
BEGIN
  ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "webhook_queue" ADD CONSTRAINT "webhook_queue_endpointId_fkey"
      FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey"
      FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables). CloudTime connects as the owner, which
-- row level security does not bind.
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "webhook_endpoints" FROM anon, authenticated;
REVOKE ALL ON "webhook_queue" FROM anon, authenticated;
REVOKE ALL ON "webhook_deliveries" FROM anon, authenticated;
