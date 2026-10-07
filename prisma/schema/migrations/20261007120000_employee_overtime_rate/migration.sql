-- Overtime rate on the employee, beside the charge and holiday rates.
-- Informational only: nothing calculates with it. Overtime pay still comes
-- from the pay rate and the rule set's overtime multiplier.
--
-- Additive: one nullable column, nothing existing changes. Written to run
-- more than once.
--
-- Undo: ALTER TABLE "employees" DROP COLUMN IF EXISTS "overtimeRate";

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "overtimeRate" DECIMAL(10,4);
