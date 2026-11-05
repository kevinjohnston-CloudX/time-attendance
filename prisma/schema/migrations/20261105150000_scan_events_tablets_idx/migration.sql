-- The tablet list on Live Attendance reads the tablets seen in the last week
-- of live scans at a few buildings. Without this index it read the whole
-- scans table on every ask (CPU audit, Nov 5 2026).
--
-- Additive. Applied on the shared database on Nov 5 2026 with CREATE INDEX
-- CONCURRENTLY (no table lock, built in under a second). Here it only runs
-- where the index is missing, so at the deploy it is a no-op and takes no
-- lock; on an empty database (a new environment) it is built plainly.
--
-- Prisma cannot describe a partial index, so it is not in schema.prisma. A
-- generated migration that drops "scan_events_tablets_idx" is wrong: edit it out.
--
-- Undo (run on its own, outside a transaction):
--   DROP INDEX CONCURRENTLY IF EXISTS public."scan_events_tablets_idx";

DO $$
BEGIN
  IF to_regclass('public.scan_events_tablets_idx') IS NULL THEN
    CREATE INDEX "scan_events_tablets_idx"
      ON public.scan_events ("tenantId", site, "createdAt" DESC)
      WHERE "deviceName" IS NOT NULL AND "sourceSlot" = 'LIVE';
  END IF;
END $$;
