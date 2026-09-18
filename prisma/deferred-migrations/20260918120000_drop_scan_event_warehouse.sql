-- Drops the superseded `warehouse` column from scan_events.
--
-- The contract half of the expand/contract begun in
-- 20260917230000_scan_event_site_and_direction_source, which added `site`,
-- copied every `warehouse` value into it, and deliberately left `warehouse` in
-- place.
--
-- *** DO NOT APPLY THIS UNTIL THE CODE THAT STOPPED WRITING `warehouse` IS
-- *** ACTUALLY SERVING PRODUCTION TRAFFIC.
--
-- `prisma migrate deploy` runs during the Vercel build while the PREVIOUS
-- deployment is still taking requests. If that deployment still writes
-- `warehouse`, dropping the column fails every kiosk scan until the build
-- finishes. That is exactly the situation this repo was in on 2026-09-17: the
-- migration was applied while the old code was live, and had the DROP been in
-- it, every punch would have errored.
--
-- Verify first, against the DEPLOYED api (not localhost):
--
--   curl -s https://<deployment>/api/timeclock/scan -X POST \
--     -H 'content-type: application/json' -H "x-api-key: $TIMECLOCK_API_KEY" \
--     -d '{"EmployeeCode":"__probe__","Stream":"SECURITY","Warehouse":"NJ299"}'
--
-- The old validator answers `expected number, received string` for Warehouse.
-- The new one does not complain about Warehouse at all. Only when the latter is
-- true is this migration safe to apply.
--
-- Safety check: refuse to drop while any row written in the last day still
-- carries a warehouse value, which would mean something is still writing it.
DO $$
DECLARE recent_writes int;
BEGIN
    SELECT count(*) INTO recent_writes
    FROM   "scan_events"
    WHERE  "warehouse" IS NOT NULL
      AND  "createdAt" > now() - interval '1 day';

    IF recent_writes > 0 THEN
        RAISE EXCEPTION
            'Refusing to drop scan_events.warehouse: % rows written in the last day still set it, so the old code is still serving. Deploy the new code first.',
            recent_writes;
    END IF;
END $$;

ALTER TABLE "scan_events" DROP COLUMN "warehouse";
