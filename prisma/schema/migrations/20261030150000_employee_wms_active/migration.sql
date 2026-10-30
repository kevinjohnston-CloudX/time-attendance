-- Whether WMS (Oracle) still employs each person, as the roster sync last saw
-- it. Read only by the gate (src/lib/presence/employment.ts); isActive, the
-- time clock, timecards and payroll are untouched.
--
-- Additive: one column, empty for everyone until the next roster sync fills
-- it, and empty counts as employed. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "employees" DROP COLUMN IF EXISTS "wmsActive";

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "wmsActive" BOOLEAN;
