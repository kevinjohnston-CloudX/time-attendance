-- Remove punch tolerance fields from shifts (replaced by shift-aware rounding on rule_sets)
ALTER TABLE "shifts" DROP COLUMN IF EXISTS "earlyInMinutes";
ALTER TABLE "shifts" DROP COLUMN IF EXISTS "lateInMinutes";
ALTER TABLE "shifts" DROP COLUMN IF EXISTS "earlyOutMinutes";
ALTER TABLE "shifts" DROP COLUMN IF EXISTS "lateOutMinutes";

-- Replace simple punchRoundingMinutes with separate In/Out rounding settings
ALTER TABLE "rule_sets" DROP COLUMN IF EXISTS "punchRoundingMinutes";
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingInEnabled"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingInMinutes"        INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingInPoint"          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingInApplyToBreaks"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingOutEnabled"       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingOutMinutes"       INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingOutPoint"         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "punchRoundingOutApplyToBreaks" BOOLEAN NOT NULL DEFAULT false;

-- Add In/Out Pair rounding fields to rule_sets
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "pairRoundingEnabled"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "pairRoundingMinutes"      INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "pairRoundingPoint"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "pairMinGuaranteedMinutes" INTEGER NOT NULL DEFAULT 0;

-- Add shift-aware rounding fields to rule_sets
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "shiftRoundingEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "shiftRoundingInWindow"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "shiftRoundingInGrace"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "shiftRoundingOutGrace"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "shiftRoundingOutWindow" INTEGER NOT NULL DEFAULT 0;

-- Add AutoPayMode enum and Guaranteed Hours / Auto-Pay fields to rule_sets
DO $$ BEGIN
  CREATE TYPE "AutoPayMode" AS ENUM ('POLICY_HOURS', 'SHIFT_HOURS');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayEnabled"                  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayMode"                     "AutoPayMode" NOT NULL DEFAULT 'POLICY_HOURS';
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayDailyMinutes"             INTEGER NOT NULL DEFAULT 480;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayWeekdaysOnly"             BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayPayCodeId"                TEXT;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayOverflowThresholdMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "autoPayOverflowPayCodeId"        TEXT;
