-- Languages, informational for now: a site's primary language and the others
-- spoken there, and the language a person prefers, as language codes ("es").
-- Nothing reads them yet beyond the screens that set them.
--
-- Additive: three columns, empty by default, so nothing changes until they
-- are filled in. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "sites" DROP COLUMN IF EXISTS "primaryLanguage";
--   ALTER TABLE "sites" DROP COLUMN IF EXISTS "additionalLanguages";
--   ALTER TABLE "employees" DROP COLUMN IF EXISTS "preferredLanguage";

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "primaryLanguage" TEXT;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "additionalLanguages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT;
