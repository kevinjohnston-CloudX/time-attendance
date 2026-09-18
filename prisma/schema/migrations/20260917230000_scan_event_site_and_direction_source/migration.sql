-- Makes scan_events able to hold what the readers actually produce, and to say
-- whether a row's direction is a fact or a guess.
--
-- Driven by replaying 93,329 real scan events out of two months of production
-- logs (timeclock + timestationscanlog, 2026-08-01 .. 2026-09-17) through the
-- table's own rules. Three things failed:
--
--   1. `warehouse` is INTEGER, but five of the eleven real site values are
--      NJ299 / NJ3 / CA2 / GA7575 / CAN. Every time-clock scan's location was
--      unstorable; only the numeric gate locations ever fit.
--
--   2. The unique key (badgeCode, stream, scanTime) treated a clock-out and the
--      next clock-in landing in the same second as a retry. 393 such pairs exist
--      in two months, and in each the swallowed event was the OPPOSITE direction
--      from the one kept — so the log silently recorded the wrong one.
--
--   3. Nothing distinguished a direction read off the source (TIMECLOCKOUT is an
--      out, definitionally) from one guessed by alternating off the previous
--      scan. 19.9% of the guesses are wrong, so the difference matters.

-- CreateEnum
CREATE TYPE "ScanDirectionSource" AS ENUM (
    -- The legacy column stated it: TIMECLOCKIN/SCANTIME = IN,
    -- TIMECLOCKOUT/OUTTIME = OUT. Ground truth, never re-resolved.
    'SOURCE_COLUMN',
    -- Inferred by alternating from this badge's previous scan. May be wrong,
    -- and is what reresolveFollowing is allowed to rewrite.
    'ALTERNATION',
    -- Planted as a baseline by the gate-state seed rather than observed.
    'SEEDED'
);

-- AlterTable: site replaces warehouse.
-- Added, backfilled, then the old column dropped, so no value is lost: every
-- warehouse that ever stored successfully was an integer, and its text form is
-- the same site.
ALTER TABLE "scan_events" ADD COLUMN "site" TEXT;
UPDATE "scan_events" SET "site" = "warehouse"::text WHERE "warehouse" IS NOT NULL;
ALTER TABLE "scan_events" DROP COLUMN "warehouse";

-- AlterTable: how this row's direction was arrived at.
-- Existing rows were all produced by alternation, which is the honest default.
ALTER TABLE "scan_events"
    ADD COLUMN "directionSource" "ScanDirectionSource" NOT NULL DEFAULT 'ALTERNATION';

-- AlterTable: which slot of the source row this event came out of.
--
-- NOT NULL with a 'LIVE' default on purpose. Postgres treats NULLs in a unique
-- index as distinct, so a nullable discriminator would stop live kiosk retries
-- from deduping at all — the exact thing the key exists to do.
ALTER TABLE "scan_events"
    ADD COLUMN "sourceSlot" TEXT NOT NULL DEFAULT 'LIVE';

-- The legacy row this event was expanded from, for tracing a row back to the
-- report it came out of. Null for live scans.
ALTER TABLE "scan_events" ADD COLUMN "sourceRef" TEXT;

-- DropIndex / CreateIndex: widen the idempotency key.
--
-- Live retries still dedupe: both posts carry sourceSlot 'LIVE', so the key is
-- unchanged in practice for them. What it stops doing is collapsing a real IN
-- and a real OUT that share a second.
--
-- Measured on the 93,329-event replay: the old key lost 450 events, 368 of them
-- direction-conflicting. This key loses 57, all of which are legacy duplicates
-- (one badge has nine shift rows claiming the same clock-in second).
DROP INDEX "scan_events_badgeCode_stream_scanTime_key";
CREATE UNIQUE INDEX "scan_events_badgeCode_stream_scanTime_sourceSlot_key"
    ON "scan_events" ("badgeCode", "stream", "scanTime", "sourceSlot");

-- CreateIndex: the backfill and the discrepancy sweep both ask "what is this
-- badge's latest scan in this stream", which the existing employeeId index
-- cannot serve for rows that matched no employee.
CREATE INDEX "scan_events_badgeCode_stream_scanTime_idx"
    ON "scan_events" ("badgeCode", "stream", "scanTime" DESC);
