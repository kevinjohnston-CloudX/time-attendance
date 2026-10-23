-- Whether a person may punch from the Punch Clock page (and the phone app),
-- or only at the time clock tablets. Off by default; on for the admins
-- (Payroll, HR, System and Super Admin), who are the only people punching
-- from the web today. HR turns it on for anyone else from the employee record.
--
-- Additive, with a default, so the code still serving during the build is
-- unaffected: it never reads the column. Written to run more than once; the
-- update only turns the admins on, so a rerun never turns anyone off.
--
-- Undo:
--   ALTER TABLE "employees" DROP COLUMN IF EXISTS "webPunchEnabled";

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "webPunchEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "employees" SET "webPunchEnabled" = true
WHERE role IN ('PAYROLL_ADMIN', 'HR_ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN') AND NOT "webPunchEnabled";
