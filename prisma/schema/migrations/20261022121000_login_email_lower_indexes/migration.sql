-- Indexes on the two sign in emails as lowercase, which is how sign in
-- (lib/login-lookup.ts), the "already used" checks (lib/login-email.ts) and
-- the users_login_email_unique rule compare them. Without them each of those
-- reads every user: a sign in, and every row of a spreadsheet import.
--
-- Additive, a few milliseconds on this table. Written to run more than once.
-- schema.prisma cannot describe an index on lower(...), so `prisma migrate dev`
-- will offer to drop these: do not let it.
--
-- Undo:
--   DROP INDEX IF EXISTS "users_email_lower_idx";
--   DROP INDEX IF EXISTS "users_workEmail_lower_idx";

CREATE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (lower("email"));
CREATE INDEX IF NOT EXISTS "users_workEmail_lower_idx" ON "users" (lower("workEmail"));
