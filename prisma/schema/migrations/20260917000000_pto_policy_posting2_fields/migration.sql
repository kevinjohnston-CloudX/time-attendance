-- AlterTable: add 2nd posting configuration fields to pto_policies
ALTER TABLE "pto_policies"
  ADD COLUMN IF NOT EXISTS "posting2ServiceMonthBasis" "ServiceMonthBasis",
  ADD COLUMN IF NOT EXISTS "posting2AnchorDate"        DATE,
  ADD COLUMN IF NOT EXISTS "posting2StartsOnYear"      INTEGER,
  ADD COLUMN IF NOT EXISTS "posting2BasedOnMonths"     BOOLEAN NOT NULL DEFAULT FALSE;
