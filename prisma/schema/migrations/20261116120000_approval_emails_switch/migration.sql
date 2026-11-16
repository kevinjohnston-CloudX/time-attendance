-- Whether a person gets approval emails: requests waiting on them, the
-- decision on their own requests, and the reminders. Turned off in My
-- profile. Phone alerts are not affected.
--
-- Additive: one column, on by default, so everyone keeps getting the emails
-- until they switch them off. A constant default is a metadata change in
-- Postgres, so no table rewrite. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "approvalEmails";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approvalEmails" BOOLEAN NOT NULL DEFAULT true;
