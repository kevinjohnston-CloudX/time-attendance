-- Row protection on employee_supervisors, the one table created since
-- 20260928200000_lock_public_tables without it (security audit 2026-11, L2).
-- CloudTime connects as the table's owner, which row protection does not
-- apply to, so the app is unaffected; Supabase's public roles find it
-- closed, as every other table. The build check scripts/check-company-scope.mjs
-- now refuses a new table without this line.
--
-- Undo:
--   ALTER TABLE "employee_supervisors" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "employee_supervisors" ENABLE ROW LEVEL SECURITY;
