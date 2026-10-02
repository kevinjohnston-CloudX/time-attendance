-- The Live Attendance gate alert switch, one per building instead of one per
-- company (Live Attendance header, System Admins). Every building starts OFF:
-- a building is only switched on by hand, once its gate tablets say which
-- building they are in. The company wide column is left in place, unread.
--
-- Additive: one nullable column, no default, nothing existing changes. Safe to
-- run more than once, and never overrides a choice already made.
-- Undo: ALTER TABLE "sites" DROP COLUMN IF EXISTS "gateAlertsOnSince";
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "gateAlertsOnSince" TIMESTAMP(3);
