-- On a meal premium line, which premium row of the rule set produced it, so a
-- waiver can name the premium by its day and row instead of its start time.
--
-- Additive: one nullable column, nothing existing changes (a nullable column
-- with no default does not rewrite the table). Filled in as timecards are
-- recalculated. Written to run more than once.
--
-- Undo: ALTER TABLE "work_segments" DROP COLUMN IF EXISTS "premiumRow";

ALTER TABLE "work_segments" ADD COLUMN IF NOT EXISTS "premiumRow" INTEGER;
