ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "payNonWorkingHolidayOnly"      BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "postWorkingHoursToAccrual"     BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "postWorkingHoursMax"           DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "postWorkingHoursExcessEnabled" BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "postWorkingHoursExcessMin"     DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "accrualCode"                  TEXT;
ALTER TABLE "holiday_rules" ADD COLUMN IF NOT EXISTS "includeNonCalcAttendance"      BOOLEAN      NOT NULL DEFAULT true;
