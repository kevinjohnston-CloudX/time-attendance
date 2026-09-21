-- Three states instead of a boolean, because the middle one is what makes the
-- security-first rule deployable.
--
-- Measured 2026-09-21 at NJ299, the only site with working gate readers: 48%
-- of morning clock-ins had a gate IN first. Enforcing would have refused ~550
-- people in a week -- two thirds of whom got into the building without the
-- reader seeing them at all, and an evening shift running at 7%.
--
-- REPORT measures a site without refusing anybody, so enforcement becomes
-- something you switch on once the number says it is safe.

-- CreateEnum
CREATE TYPE "GateScanMode" AS ENUM ('OFF', 'REPORT', 'ENFORCE');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN "gateScanMode" "GateScanMode" NOT NULL DEFAULT 'OFF';

-- Carry the existing flag over, so nothing changes behaviour on deploy.
UPDATE "sites" SET "gateScanMode" = 'ENFORCE' WHERE "requireGateScan" = true;

-- requireGateScan is deliberately left in place. Dropping it in the same
-- migration would break the currently-running deployment in the window between
-- the migration and the new code going live.
