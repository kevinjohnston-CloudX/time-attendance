-- The hours code ADP expects for a pay code (PTI, NSI...), written in the ADP
-- EPI file in place of the Express code. Not unique: two pay codes can go to
-- ADP under one code, as PTO and PTO Carryover both go as PTI.
--
-- Additive: one nullable column, nothing existing changes. Written to run more
-- than once.
--
-- Undo: ALTER TABLE "pay_codes" DROP COLUMN IF EXISTS "adpCode";

ALTER TABLE "pay_codes" ADD COLUMN IF NOT EXISTS "adpCode" TEXT;
