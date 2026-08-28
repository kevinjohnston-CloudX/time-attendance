-- Add bypass eligibility option to individual holidays
ALTER TABLE "holidays"
  ADD COLUMN IF NOT EXISTS "bypass_after_eligibility" BOOLEAN NOT NULL DEFAULT false;
