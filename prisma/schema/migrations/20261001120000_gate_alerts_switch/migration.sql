-- The Live Attendance gate alert switch, one per company (Company Settings).
-- Additive and safe to run more than once: the column is new, nullable, and
-- existing companies start with the alert on, as it is today.
-- Undo: ALTER TABLE "tenants" DROP COLUMN IF EXISTS "gateAlertsOnSince";
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "gateAlertsOnSince" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
