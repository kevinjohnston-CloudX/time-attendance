-- When each login's password was last set. A web sign in or mobile token
-- from before it is ended, so an administrator's reset (a temporary password
-- or a setup link) signs the person out everywhere, not only at their next
-- sign in.
--
-- Additive: one nullable column, nothing existing changes, and code already
-- deployed does not read it. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "passwordChangedAt";

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
