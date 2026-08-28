CREATE TABLE IF NOT EXISTS "holiday_rule_holidays" (
  "holidayRuleId" TEXT NOT NULL,
  "holidayId"     TEXT NOT NULL,
  PRIMARY KEY ("holidayRuleId", "holidayId"),
  CONSTRAINT "holiday_rule_holidays_holidayRuleId_fkey" FOREIGN KEY ("holidayRuleId") REFERENCES "holiday_rules"("id") ON DELETE CASCADE,
  CONSTRAINT "holiday_rule_holidays_holidayId_fkey"     FOREIGN KEY ("holidayId")     REFERENCES "holidays"("id")      ON DELETE CASCADE
);
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "birthdayIsHoliday"       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "holidayOverridesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "holidayOverrides"        JSONB;
