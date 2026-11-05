-- Whether a pay code is paid: off leaves its hours out of the payroll file,
-- though they stay on timecards and in reports (FMLA, which payroll does not
-- pay). Only the ADP file reads it.
--
-- Additive: one column, on by default, so every pay code goes to payroll as
-- it does now until one is switched off. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "pay_codes" DROP COLUMN IF EXISTS "isPaid";

ALTER TABLE "pay_codes" ADD COLUMN IF NOT EXISTS "isPaid" BOOLEAN NOT NULL DEFAULT true;
