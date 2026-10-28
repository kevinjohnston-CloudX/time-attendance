-- What each API key may read beyond the original external API (leave types and
-- time off requests, which every active key keeps exactly as before). The first
-- is "people:read", the employee directory at /api/external/people.
--
-- Additive: one column that starts empty for every key, so no key, existing or
-- new, gains access until a company admin turns it on. Code already deployed
-- does not read it. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "scopes";

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
