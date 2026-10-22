-- Moves each company address (Bergen, Cloudx, REX11) from the one email
-- everybody had into the new work email, so the employee record shows it
-- under Work email and the personal email is left for a personal address.
--
-- SAFE ONLY ONCE the code that signs people in by either email is serving
-- (20261022120000_work_email_last_tenant and the code beside it). Before that,
-- these people could not sign in, because the old code only looks at "email".
-- Check the live site first; do not assume a push deployed.
--
-- Nobody's sign in changes: the same address still signs them in, now from
-- the work email (saved lowercase; sign in ignores capitals). Each moved
-- address is copied first into a small table, and the undo puts back exactly
-- those, as spelled, on rows nobody has changed since.
--
-- Skipped on purpose: a row whose address another person also holds,
-- differing only by capitals (two people, one mailbox; for HR to sort out by
-- hand). The one address, one person rule would refuse those.
--
-- Run by hand (not through prisma migrate), in one transaction:
--   psql "$DIRECT_URL" -1 -f prisma/deferred-migrations/20261022130000_move_company_emails.sql
--
-- Undo (same transaction style), then optionally drop the copy table:
--   UPDATE "users" u SET "email" = m."email", "workEmail" = NULL
--     FROM "_moved_company_emails_20261022" m
--    WHERE u.id = m."userId" AND u."email" IS NULL AND u."workEmail" = lower(m."email");
--   DROP TABLE IF EXISTS "_moved_company_emails_20261022";

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS "_moved_company_emails_20261022" (
  "userId"  TEXT PRIMARY KEY,
  "email"   TEXT NOT NULL,
  "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "_moved_company_emails_20261022" ENABLE ROW LEVEL SECURITY;

INSERT INTO "_moved_company_emails_20261022" ("userId", "email")
SELECT u.id, u.email
FROM "users" u
WHERE u.email IS NOT NULL
  AND u."workEmail" IS NULL
  AND lower(split_part(u.email, '@', 2)) IN
      ('bergenlogistics.com', 'cloudxsystems.net', 'rex11.com', 'bergenlogisics.com', 'bergen.com', 'cloudxsystemstest.net')
  AND NOT EXISTS (
    SELECT 1 FROM "users" o
    WHERE o.id <> u.id AND (lower(o.email) = lower(u.email) OR lower(o."workEmail") = lower(u.email))
  )
ON CONFLICT ("userId") DO NOTHING;

UPDATE "users" u
SET "workEmail" = lower(m."email"), "email" = NULL
FROM "_moved_company_emails_20261022" m
WHERE u.id = m."userId" AND u."workEmail" IS NULL AND u."email" = m."email";
