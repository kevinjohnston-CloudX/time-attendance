-- Meal lockout: a time clock clock in less than this many clock minutes after
-- a clock out is refused with "Please wait N minutes before clocking in
-- again", as Oracle refuses it for California. The tablets show CloudTime's
-- answer, so Oracle's refusal went unseen and people went back to work after
-- 28-29 minute lunches (36 times in the 3 weeks to 10/29).
--
-- Additive: one column, 0 (off) by default, so no rule set changes until one
-- is given minutes. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "rule_sets" DROP COLUMN IF EXISTS "mealLockoutMinutes";

ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealLockoutMinutes" INTEGER NOT NULL DEFAULT 0;
