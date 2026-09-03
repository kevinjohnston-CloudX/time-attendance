-- Add per-day auto-pay schedule column
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayDaySchedule" JSONB;

-- Migrate existing flat config (autoPayDailyMinutes + autoPayWeekdaysOnly) to per-day schedule.
-- Only needed for rows where autoPayEnabled = true; others stay null (auto-pay won't run).
UPDATE "rule_sets"
SET "autoPayDaySchedule" = CASE
  WHEN "autoPayWeekdaysOnly" = true THEN
    jsonb_build_array(
      jsonb_build_object('day', 0, 'apply', false, 'minutes', 0),
      jsonb_build_object('day', 1, 'apply', true,  'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 2, 'apply', true,  'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 3, 'apply', true,  'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 4, 'apply', true,  'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 5, 'apply', true,  'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 6, 'apply', false, 'minutes', 0)
    )
  ELSE
    jsonb_build_array(
      jsonb_build_object('day', 0, 'apply', true, 'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 1, 'apply', true, 'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 2, 'apply', true, 'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 3, 'apply', true, 'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 4, 'apply', true, 'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 5, 'apply', true, 'minutes', "autoPayDailyMinutes"),
      jsonb_build_object('day', 6, 'apply', true, 'minutes', "autoPayDailyMinutes")
    )
END
WHERE "autoPayEnabled" = true;

-- Drop superseded columns
ALTER TABLE "rule_sets" DROP COLUMN IF EXISTS "autoPayDailyMinutes";
ALTER TABLE "rule_sets" DROP COLUMN IF EXISTS "autoPayWeekdaysOnly";
