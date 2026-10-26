-- Leave kept exact to the hundredth of an hour, as NovaTime keeps it. Whole
-- minutes could not hold most of NovaTime's figures: a 6.16 hour accrual is
-- 369.6 minutes and posted as 370, so balances showed 6.17; a 0.56 hour PTO
-- payout saved as 0.57. In seconds every hundredth is exact (0.01 h = 36 s),
-- and so is every minute from a punch.
--
-- Each amount gets a seconds column beside its minutes. A trigger keeps the
-- two in step whichever one is written: seconds written sets the minutes,
-- rounded; minutes written (the code still serving during the build, the
-- timecard engine, anything not moved yet) sets the seconds. So whatever
-- still reads minutes keeps reading the same numbers, to the minute.
--
-- Additive: new columns with defaults, filled from the minutes, which is exact
-- (minutes x 60). Written to run more than once. The minute columns get a
-- default of 0 so new code can write the seconds alone.
--
-- Undo:
--   DROP TRIGGER IF EXISTS leave_requests_seconds ON "leave_requests";
--   DROP TRIGGER IF EXISTS leave_balances_seconds ON "leave_balances";
--   DROP TRIGGER IF EXISTS leave_accrual_ledger_seconds ON "leave_accrual_ledger";
--   DROP TRIGGER IF EXISTS work_segments_seconds ON "work_segments";
--   DROP TRIGGER IF EXISTS overtime_buckets_seconds ON "overtime_buckets";
--   DROP FUNCTION IF EXISTS leave_requests_seconds(), leave_balances_seconds(), leave_accrual_ledger_seconds(), work_segments_seconds(), overtime_buckets_seconds();
--   ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "durationSeconds";
--   ALTER TABLE "leave_balances" DROP COLUMN IF EXISTS "balanceSeconds", DROP COLUMN IF EXISTS "usedSeconds";
--   ALTER TABLE "leave_accrual_ledger" DROP COLUMN IF EXISTS "deltaSeconds", DROP COLUMN IF EXISTS "balanceAfterSeconds";
--   ALTER TABLE "work_segments" DROP COLUMN IF EXISTS "durationSeconds";
--   ALTER TABLE "overtime_buckets" DROP COLUMN IF EXISTS "totalSeconds";

ALTER TABLE "leave_requests"       ADD COLUMN IF NOT EXISTS "durationSeconds"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leave_balances"       ADD COLUMN IF NOT EXISTS "balanceSeconds"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leave_balances"       ADD COLUMN IF NOT EXISTS "usedSeconds"         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leave_accrual_ledger" ADD COLUMN IF NOT EXISTS "deltaSeconds"        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leave_accrual_ledger" ADD COLUMN IF NOT EXISTS "balanceAfterSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_segments"        ADD COLUMN IF NOT EXISTS "durationSeconds"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "overtime_buckets"     ADD COLUMN IF NOT EXISTS "totalSeconds"        INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "leave_requests"       ALTER COLUMN "durationMinutes" SET DEFAULT 0;
ALTER TABLE "leave_accrual_ledger" ALTER COLUMN "deltaMinutes"    SET DEFAULT 0;
ALTER TABLE "leave_accrual_ledger" ALTER COLUMN "balanceAfter"    SET DEFAULT 0;
ALTER TABLE "work_segments"        ALTER COLUMN "durationMinutes" SET DEFAULT 0;

-- The amounts so far, in seconds. Exact: they were whole minutes.
UPDATE "leave_requests"       SET "durationSeconds" = "durationMinutes" * 60 WHERE "durationSeconds" = 0 AND "durationMinutes" <> 0;
UPDATE "leave_balances"       SET "balanceSeconds" = "balanceMinutes" * 60 WHERE "balanceSeconds" = 0 AND "balanceMinutes" <> 0;
UPDATE "leave_balances"       SET "usedSeconds" = "usedMinutes" * 60 WHERE "usedSeconds" = 0 AND "usedMinutes" <> 0;
UPDATE "leave_accrual_ledger" SET "deltaSeconds" = "deltaMinutes" * 60 WHERE "deltaSeconds" = 0 AND "deltaMinutes" <> 0;
UPDATE "leave_accrual_ledger" SET "balanceAfterSeconds" = "balanceAfter" * 60 WHERE "balanceAfterSeconds" = 0 AND "balanceAfter" <> 0;
UPDATE "work_segments"        SET "durationSeconds" = "durationMinutes" * 60 WHERE "durationSeconds" = 0 AND "durationMinutes" <> 0;
UPDATE "overtime_buckets"     SET "totalSeconds" = "totalMinutes" * 60 WHERE "totalSeconds" = 0 AND "totalMinutes" <> 0;

-- One pair: on insert, seconds given wins, else seconds from the minutes; on
-- update, whichever of the two changed sets the other.
CREATE OR REPLACE FUNCTION leave_requests_seconds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."durationSeconds" <> 0 THEN NEW."durationMinutes" := round(NEW."durationSeconds" / 60.0);
    ELSE NEW."durationSeconds" := NEW."durationMinutes" * 60; END IF;
  ELSIF NEW."durationSeconds" IS DISTINCT FROM OLD."durationSeconds" THEN NEW."durationMinutes" := round(NEW."durationSeconds" / 60.0);
  ELSIF NEW."durationMinutes" IS DISTINCT FROM OLD."durationMinutes" THEN NEW."durationSeconds" := NEW."durationMinutes" * 60;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION work_segments_seconds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."durationSeconds" <> 0 THEN NEW."durationMinutes" := round(NEW."durationSeconds" / 60.0);
    ELSE NEW."durationSeconds" := NEW."durationMinutes" * 60; END IF;
  ELSIF NEW."durationSeconds" IS DISTINCT FROM OLD."durationSeconds" THEN NEW."durationMinutes" := round(NEW."durationSeconds" / 60.0);
  ELSIF NEW."durationMinutes" IS DISTINCT FROM OLD."durationMinutes" THEN NEW."durationSeconds" := NEW."durationMinutes" * 60;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION overtime_buckets_seconds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."totalSeconds" <> 0 THEN NEW."totalMinutes" := round(NEW."totalSeconds" / 60.0);
    ELSE NEW."totalSeconds" := NEW."totalMinutes" * 60; END IF;
  ELSIF NEW."totalSeconds" IS DISTINCT FROM OLD."totalSeconds" THEN NEW."totalMinutes" := round(NEW."totalSeconds" / 60.0);
  ELSIF NEW."totalMinutes" IS DISTINCT FROM OLD."totalMinutes" THEN NEW."totalSeconds" := NEW."totalMinutes" * 60;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION leave_balances_seconds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."balanceSeconds" <> 0 THEN NEW."balanceMinutes" := round(NEW."balanceSeconds" / 60.0);
    ELSE NEW."balanceSeconds" := NEW."balanceMinutes" * 60; END IF;
    IF NEW."usedSeconds" <> 0 THEN NEW."usedMinutes" := round(NEW."usedSeconds" / 60.0);
    ELSE NEW."usedSeconds" := NEW."usedMinutes" * 60; END IF;
  ELSE
    IF NEW."balanceSeconds" IS DISTINCT FROM OLD."balanceSeconds" THEN NEW."balanceMinutes" := round(NEW."balanceSeconds" / 60.0);
    ELSIF NEW."balanceMinutes" IS DISTINCT FROM OLD."balanceMinutes" THEN NEW."balanceSeconds" := NEW."balanceMinutes" * 60;
    END IF;
    IF NEW."usedSeconds" IS DISTINCT FROM OLD."usedSeconds" THEN NEW."usedMinutes" := round(NEW."usedSeconds" / 60.0);
    ELSIF NEW."usedMinutes" IS DISTINCT FROM OLD."usedMinutes" THEN NEW."usedSeconds" := NEW."usedMinutes" * 60;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION leave_accrual_ledger_seconds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."deltaSeconds" <> 0 THEN NEW."deltaMinutes" := round(NEW."deltaSeconds" / 60.0);
    ELSE NEW."deltaSeconds" := NEW."deltaMinutes" * 60; END IF;
    IF NEW."balanceAfterSeconds" <> 0 THEN NEW."balanceAfter" := round(NEW."balanceAfterSeconds" / 60.0);
    ELSE NEW."balanceAfterSeconds" := NEW."balanceAfter" * 60; END IF;
  ELSE
    IF NEW."deltaSeconds" IS DISTINCT FROM OLD."deltaSeconds" THEN NEW."deltaMinutes" := round(NEW."deltaSeconds" / 60.0);
    ELSIF NEW."deltaMinutes" IS DISTINCT FROM OLD."deltaMinutes" THEN NEW."deltaSeconds" := NEW."deltaMinutes" * 60;
    END IF;
    IF NEW."balanceAfterSeconds" IS DISTINCT FROM OLD."balanceAfterSeconds" THEN NEW."balanceAfter" := round(NEW."balanceAfterSeconds" / 60.0);
    ELSIF NEW."balanceAfter" IS DISTINCT FROM OLD."balanceAfter" THEN NEW."balanceAfterSeconds" := NEW."balanceAfter" * 60;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leave_requests_seconds ON "leave_requests";
CREATE TRIGGER leave_requests_seconds BEFORE INSERT OR UPDATE ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION leave_requests_seconds();
DROP TRIGGER IF EXISTS work_segments_seconds ON "work_segments";
CREATE TRIGGER work_segments_seconds BEFORE INSERT OR UPDATE ON "work_segments" FOR EACH ROW EXECUTE FUNCTION work_segments_seconds();
DROP TRIGGER IF EXISTS overtime_buckets_seconds ON "overtime_buckets";
CREATE TRIGGER overtime_buckets_seconds BEFORE INSERT OR UPDATE ON "overtime_buckets" FOR EACH ROW EXECUTE FUNCTION overtime_buckets_seconds();
DROP TRIGGER IF EXISTS leave_balances_seconds ON "leave_balances";
CREATE TRIGGER leave_balances_seconds BEFORE INSERT OR UPDATE ON "leave_balances" FOR EACH ROW EXECUTE FUNCTION leave_balances_seconds();
DROP TRIGGER IF EXISTS leave_accrual_ledger_seconds ON "leave_accrual_ledger";
CREATE TRIGGER leave_accrual_ledger_seconds BEFORE INSERT OR UPDATE ON "leave_accrual_ledger" FOR EACH ROW EXECUTE FUNCTION leave_accrual_ledger_seconds();
