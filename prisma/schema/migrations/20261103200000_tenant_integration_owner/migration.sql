-- Which company the platform's ADP connection and WMS bridge belong to.
-- There is one of each for the whole platform; until now every company could
-- use them, so the demo company received Main Office's Oracle roster every 5
-- minutes and could have synced or pushed payroll through Main Office's ADP
-- (security audit 2026-11, H2). Off for every company, then on for Main
-- Office, which owns both today.
--
-- Additive: two columns. Older code never reads them. Written to run more
-- than once.
--
-- Undo:
--   ALTER TABLE "tenants" DROP COLUMN IF EXISTS "adpConnected", DROP COLUMN IF EXISTS "wmsConnected";

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "adpConnected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "wmsConnected" BOOLEAN NOT NULL DEFAULT false;

UPDATE "tenants" SET "adpConnected" = true, "wmsConnected" = true WHERE "id" = 'cmm9mxrup0000kgug6sa5gw53';
