-- A second sign in email (the work email) beside the existing one (now the
-- personal email), and the company a super admin last worked in, so the next
-- sign in goes straight back into it.
--
-- Additive: two nullable columns and a unique index on a column that starts
-- empty, so nothing existing changes and the index cannot fail. Code already
-- deployed does not read either column. Written to run more than once.
--
-- Plus one rule the old unique index could not express: an address belongs to
-- one person, across both columns and ignoring capitals ("Ana@x.com" and
-- "ana@x.com" are the same mailbox, and either column signs in). It is checked
-- only when an address is set or changed, so the few logins that already
-- differ only by capitals keep working and can still be edited.
--
-- Moving today's company addresses into the work email is a separate step,
-- prisma/deferred-migrations/20261022130000_move_company_emails.sql, run only
-- once this code is serving.
--
-- Undo:
--   DROP TRIGGER IF EXISTS users_login_email_unique ON "users";
--   DROP FUNCTION IF EXISTS users_login_email_unique();
--   DROP INDEX IF EXISTS "users_workEmail_key";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "workEmail";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "lastTenantId";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "workEmail" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastTenantId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_workEmail_key" ON "users"("workEmail");

CREATE OR REPLACE FUNCTION users_login_email_unique() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  addr text;
BEGIN
  IF NEW.email IS NOT NULL AND NEW."workEmail" IS NOT NULL AND lower(NEW.email) = lower(NEW."workEmail")
     AND (TG_OP = 'INSERT' OR NEW.email IS DISTINCT FROM OLD.email OR NEW."workEmail" IS DISTINCT FROM OLD."workEmail") THEN
    RAISE EXCEPTION 'The work email and the personal email are the same address' USING ERRCODE = '23505';
  END IF;
  FOREACH addr IN ARRAY ARRAY[
    CASE WHEN TG_OP = 'INSERT' OR NEW.email IS DISTINCT FROM OLD.email THEN NEW.email END,
    CASE WHEN TG_OP = 'INSERT' OR NEW."workEmail" IS DISTINCT FROM OLD."workEmail" THEN NEW."workEmail" END
  ] LOOP
    IF addr IS NOT NULL AND EXISTS (
      SELECT 1 FROM "users" u
      WHERE u.id <> NEW.id AND (lower(u.email) = lower(addr) OR lower(u."workEmail") = lower(addr))
    ) THEN
      RAISE EXCEPTION 'The email % is already used by another person', addr USING ERRCODE = '23505';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_login_email_unique ON "users";
CREATE TRIGGER users_login_email_unique
  BEFORE INSERT OR UPDATE OF email, "workEmail" ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_login_email_unique();
