-- Charge rates beside pay rates. Each pay rate row (effective dated) gets a
-- markup percent and the charge rate it gives, Rate 1 × (1 + markup) to the
-- cent, or a charge rate set by hand when an agency agreement does not follow
-- the formula. An agency gets a default markup for its people's new rows.
--
-- Additive: new nullable columns and one with a default, nothing existing
-- changes. employees."chargeRate" and agencies."chargeRate" stay as they are
-- for code already deployed. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "employee_pay_rates" DROP COLUMN IF EXISTS "markupPct", DROP COLUMN IF EXISTS "chargeRate", DROP COLUMN IF EXISTS "chargeManual";
--   ALTER TABLE "agencies" DROP COLUMN IF EXISTS "defaultMarkupPct";

ALTER TABLE "employee_pay_rates" ADD COLUMN IF NOT EXISTS "markupPct" DECIMAL(7,3);
ALTER TABLE "employee_pay_rates" ADD COLUMN IF NOT EXISTS "chargeRate" DECIMAL(10,4);
ALTER TABLE "employee_pay_rates" ADD COLUMN IF NOT EXISTS "chargeManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "defaultMarkupPct" DECIMAL(7,3);
