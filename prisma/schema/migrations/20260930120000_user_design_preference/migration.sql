-- Which design each person sees, Classic or New. Nullable with no default, so
-- adding it rewrites no rows and changes nothing for anyone: empty reads as
-- Classic. IF NOT EXISTS, so running it where it was applied by hand is a no-op.
--
-- Undo: ALTER TABLE "users" DROP COLUMN IF EXISTS "designPreference";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "designPreference" TEXT;
