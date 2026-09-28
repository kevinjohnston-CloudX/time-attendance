-- Close the public schema to Supabase's API roles.
--
-- Supabase serves every table in `public` through its REST and GraphQL API to
-- anyone holding the project's public key, limited only by row level
-- security. 38 of 63 tables had it off, and the default privileges granted
-- every new table in full to `anon` and `authenticated`, so each new table
-- started open. CloudTime never uses those roles: it connects as the table
-- owner, which is not bound by row level security, so nothing in the app
-- changes.
--
-- Safe to run more than once. Undo, written from a snapshot taken before the
-- change: _private/rls-undo-2026-09-28.sql in the folder above the repo.

-- Row level security on every table in public, with no policies: the API
-- roles see nothing, the owner is unaffected.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- No privileges for the API roles on anything that exists now...
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- ...or on anything our migrations create later.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
