-- Row protection on the Manager departments table (20261116210000_manager_role),
-- which was created without it, like every other new table here. With no
-- policy, Supabase's public web access reads and writes nothing; CloudTime
-- reaches it as the table's owner, so the app is unaffected. Written to run
-- more than once.
--
-- Undo:
--   ALTER TABLE "manager_department_access" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "manager_department_access" ENABLE ROW LEVEL SECURITY;
