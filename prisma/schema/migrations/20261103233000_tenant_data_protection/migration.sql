-- Data protection settings per company, for EU companies: which country's
-- rules a company follows and the switches that come with them (the first is
-- keeping medical details out of sick leave notes). Empty, which every
-- existing company is, means CloudTime works exactly as it did before.
--
-- Additive: one empty column. Written to run more than once, so it is a no-op
-- where it was applied ahead of the deploy.
--
-- Undo (every company goes back to having no data protection settings):
--   ALTER TABLE "tenants" DROP COLUMN IF EXISTS "dataProtection";

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "dataProtection" JSONB;
