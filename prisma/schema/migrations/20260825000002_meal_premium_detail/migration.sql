-- Add Meal Premium detail settings to rule_sets
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealPremiumUseActualForWindow"  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealPremiumUseActualForMinimum" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealPremiumLimitToPayMinutes"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealPremiumAllowTimesheetEdits" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealPremiumUseTransferGroup"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "mealPremiumRows"                JSONB;
