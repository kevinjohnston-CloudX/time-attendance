-- Stand-in schedules: when Oracle has not sent a building's day by the
-- morning, CloudTime writes one from the last seven days so the gates do not
-- refuse everybody, and removes what Oracle does not confirm once it arrives.
-- See src/lib/services/schedule-stand-in.ts.
--
-- Additive: two enum values, nothing existing changes. Written to run more
-- than once.
--
-- Undo: Postgres cannot drop an enum value. Delete the rows first
--   DELETE FROM "schedule_days" WHERE "source" = 'STAND_IN';
--   DELETE FROM "sync_runs" WHERE "kind" = 'SCHEDULE_STAND_IN';
-- and the unused values are harmless left in place.

ALTER TYPE "ScheduleSource" ADD VALUE IF NOT EXISTS 'STAND_IN';
ALTER TYPE "SyncKind" ADD VALUE IF NOT EXISTS 'SCHEDULE_STAND_IN';
