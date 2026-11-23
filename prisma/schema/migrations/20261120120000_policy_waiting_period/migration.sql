-- NovaTime's new-hire hold. NJPTO25 and PTO160 earn PTO every fortnight from
-- hire, held until three months of service, then all of it is released; NJ
-- Sick (SCKNX8NJ) gives its 40 hours on the day three months of service end.
-- Here the tiers started at three months, so the held fortnights were lost and
-- NJ Sick waited for January 1 (Johanna Banchon, hired 8/11: NovaTime released
-- 12.32 h PTO on 11/21 and 40 h Sick on 11/11; here 1.54 and none).
--
-- Additive: one nullable column, and three policies given 3. Code before this
-- one never reads the column, so applying it ahead of the deploy changes
-- nothing. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "pto_policies" DROP COLUMN IF EXISTS "waitingPeriodMonths";

ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "waitingPeriodMonths" INTEGER;

UPDATE "pto_policies" SET "waitingPeriodMonths" = 3
WHERE "name" IN ('NJPTO25', 'PTO160', 'SCKNX8NJ') AND "waitingPeriodMonths" IS NULL;
