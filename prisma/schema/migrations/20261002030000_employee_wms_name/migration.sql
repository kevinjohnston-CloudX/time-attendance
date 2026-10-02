-- The name WMS (Oracle) holds for each employee, beside the legal name in
-- users.name. The roster sync fills it and keeps it current; the tablets and
-- Live Attendance show it. users.name stays the name of record and the sync no
-- longer writes it (owner, 2026-10-01: keep the legal name in CloudTime, show
-- the WMS name on the tablets and in Live Attendance).
--
-- Additive: one nullable column, nothing existing changes. Written to run more
-- than once, so it is a no-op where it was applied ahead of the deploy.
--
-- Undo: ALTER TABLE "employees" DROP COLUMN IF EXISTS "wmsName";

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "wmsName" TEXT;
