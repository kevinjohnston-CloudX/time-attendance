-- A leave policy can take leave from other balances first, in order, before
-- its own: NovaTime's "advanced secondary pay codes with partial hours
-- deductions". PTO120 and PTO160 use PTO Carry Over before PTO, so 5 hours of
-- PTO with 1.5 left in carry over comes off as 1.5 PTO Carry Over and 3.5 PTO.
--
-- Additive: one column, empty by default, so every policy keeps working as it
-- did until one is given a list. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "pto_policies" DROP COLUMN IF EXISTS "useFirstLeaveTypeIds";

ALTER TABLE "pto_policies" ADD COLUMN IF NOT EXISTS "useFirstLeaveTypeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
