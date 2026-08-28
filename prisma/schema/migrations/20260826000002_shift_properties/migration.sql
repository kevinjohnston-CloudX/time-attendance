-- Shift cycle and type enums
CREATE TYPE "ShiftCycle" AS ENUM ('WEEKLY', 'CUSTOM');
CREATE TYPE "ShiftType"  AS ENUM ('FIXED', 'FLEXIBLE', 'DYNAMIC');

-- New shift properties columns
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "excludeFromSetup"           BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "shiftCycle"                 "ShiftCycle" NOT NULL DEFAULT 'WEEKLY';
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "cycleDays"                  INTEGER      NOT NULL DEFAULT 7;
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "cycleReferenceDate"         TIMESTAMPTZ;
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "shiftType"                  "ShiftType"  NOT NULL DEFAULT 'FIXED';
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "useScheduleGroupQualifiers" BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "averageHours"               DECIMAL(5,2);
