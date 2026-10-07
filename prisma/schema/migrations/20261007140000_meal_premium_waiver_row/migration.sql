-- Which premium row a meal premium waiver is for. With the date it identifies
-- the premium; the premium's start time, which waivers were matched on, moves
-- whenever that day's punches change, and the premium came back.
--
-- Additive: one nullable column, nothing existing changes. Waivers without it
-- keep matching on their start time. Written to run more than once.
--
-- Undo: ALTER TABLE "meal_premium_waivers" DROP COLUMN IF EXISTS "rowIndex";

ALTER TABLE "meal_premium_waivers" ADD COLUMN IF NOT EXISTS "rowIndex" INTEGER;
