ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "payCodeId"               TEXT;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "includeOnProbation"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "tenureRequiredEnabled"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "tenureRequiredDays"      INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "tenureRequiredBasis"     TEXT    NOT NULL DEFAULT 'HIRE_DATE';
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "tenureRequiredUnit"      TEXT    NOT NULL DEFAULT 'DAYS';
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "dailyWeeklyAveragingOnly" BOOLEAN NOT NULL DEFAULT false;
