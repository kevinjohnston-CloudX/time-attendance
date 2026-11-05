-- Push notifications in the phone app (src/lib/push): which phones belong to
-- which person, so a leave decision or a request waiting on someone reaches
-- their phone. One new table.
--
-- Additive: nothing existing changes. Written to run more than once, so it is
-- a no-op where it was applied ahead of the deploy.
--
-- Undo (every phone simply stops getting notifications until it registers again):
--   DROP TABLE IF EXISTS "push_devices";

CREATE TABLE IF NOT EXISTS "push_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX IF NOT EXISTS "push_devices_userId_idx" ON "push_devices"("userId");

DO $$
BEGIN
  ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables). CloudTime connects as the owner, which
-- row level security does not bind.
ALTER TABLE "push_devices" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "push_devices" FROM anon, authenticated;
