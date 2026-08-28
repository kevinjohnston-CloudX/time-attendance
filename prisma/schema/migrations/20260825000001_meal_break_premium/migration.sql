-- Add Meal/Break Premium fields to rule_sets
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealBreakPremiumEnabled"              BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealBreakPremiumMaxPerDay"            INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealBreakPremiumResetEnabled"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealBreakPremiumResetMinutes"         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealBreakPremiumWaivedMsgEnabled"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealBreakPremiumWaivedMsg"            TEXT;
