-- Charge rate and holiday rate on the employee, as NovaTime's Miscellaneous
-- Rate. Informational only: nothing calculates with them.
--
-- Additive: two nullable columns, nothing existing changes. Written to run
-- more than once.
--
-- Undo: ALTER TABLE "employees" DROP COLUMN IF EXISTS "chargeRate", DROP COLUMN IF EXISTS "holidayRate";

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "chargeRate" DECIMAL(10,4);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "holidayRate" DECIMAL(10,4);
