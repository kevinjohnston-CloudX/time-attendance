-- Rename column to match Prisma camelCase convention
ALTER TABLE "holidays"
  RENAME COLUMN "bypass_after_eligibility" TO "bypassAfterEligibility";
