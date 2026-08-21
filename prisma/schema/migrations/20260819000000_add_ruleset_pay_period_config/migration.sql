-- DropIndex
DROP INDEX IF EXISTS "pay_periods_tenantId_startDate_endDate_key";
DROP INDEX IF EXISTS "pay_periods_tenantId_startDate_endDate_idx";

-- AlterTable
ALTER TABLE "pay_periods" ADD COLUMN IF NOT EXISTS "ruleSetId" TEXT;

-- AlterTable
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "payFrequency" "PayFrequency",
ADD COLUMN IF NOT EXISTS "payPeriodAnchorDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pay_periods_tenantId_startDate_endDate_idx" ON "pay_periods"("tenantId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pay_periods_ruleSetId_startDate_endDate_idx" ON "pay_periods"("ruleSetId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "pay_periods" DROP CONSTRAINT IF EXISTS "pay_periods_ruleSetId_fkey";
ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "rule_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
