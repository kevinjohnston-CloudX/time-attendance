-- The Live Attendance gate alert switch, one per company (Company Settings).
-- Starts OFF: the alert was not reliable when this shipped, so it stays hidden
-- until a System Admin turns it on. No default, so existing and new companies
-- alike start off.
--
-- Safe to run more than once, and never overrides a choice already made: if
-- the column is already there its values are left alone. DROP DEFAULT clears
-- the default an earlier draft of this file gave the column on the shared
-- database (2026-10-01, applied by hand), and does nothing anywhere else.
-- Undo: ALTER TABLE "tenants" DROP COLUMN IF EXISTS "gateAlertsOnSince";
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "gateAlertsOnSince" TIMESTAMP(3);
ALTER TABLE "tenants" ALTER COLUMN "gateAlertsOnSince" DROP DEFAULT;
