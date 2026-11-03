-- Working time checks for EU rule sets: a rule set can check the day's hours,
-- the rest between shifts and the breaks against one country's law (Germany,
-- the Netherlands or the United Kingdom) and raise exceptions for what falls
-- short. OFF, the default and what every existing rule set gets, checks
-- nothing, exactly as before.
--
-- Additive: one column with a default, and one new exception type. Written to
-- run more than once, so it is a no-op where it was applied ahead of the deploy.
--
-- Undo:
--   ALTER TABLE "rule_sets" DROP COLUMN IF EXISTS "workingTimeChecks";
-- Postgres cannot drop an enum value; SHORT_REST stays in "ExceptionType" and
-- is harmless while nothing uses it. Remove any rows that used it first:
--   DELETE FROM "exceptions" WHERE "exceptionType" = 'SHORT_REST';

ALTER TABLE "rule_sets" ADD COLUMN IF NOT EXISTS "workingTimeChecks" TEXT NOT NULL DEFAULT 'OFF';

ALTER TYPE "ExceptionType" ADD VALUE IF NOT EXISTS 'SHORT_REST';
