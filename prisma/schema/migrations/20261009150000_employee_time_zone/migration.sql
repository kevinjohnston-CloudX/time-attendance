-- A person's own time zone, for someone working in another zone than their
-- site. Null means the site's zone. Every place that reads a person's times
-- (typed timecard entries, the timecard calculation, history, reports) uses it
-- first and the site's zone otherwise.
--
-- Additive: one nullable column, nothing existing changes. Written to run more
-- than once.
--
-- Undo: ALTER TABLE "employees" DROP COLUMN IF EXISTS "timeZone";

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "timeZone" TEXT;
