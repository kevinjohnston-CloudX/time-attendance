-- Supervisors of an employee besides their supervisor of record
-- (employees."supervisorId"): an agency's view-only user beside the warehouse
-- supervisor, say. Each one sees the person on their team screens; what they
-- may do there comes from their own role. The supervisor of record is what
-- the HR file, ADP and reports keep using.
--
-- Additive: one new table, nothing existing changes. Written to run more
-- than once.
--
-- Undo: DROP TABLE IF EXISTS "employee_supervisors";

CREATE TABLE IF NOT EXISTS "employee_supervisors" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "employee_supervisors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_supervisors_employeeId_supervisorId_key" ON "employee_supervisors"("employeeId", "supervisorId");
CREATE INDEX IF NOT EXISTS "employee_supervisors_supervisorId_idx" ON "employee_supervisors"("supervisorId");

DO $$ BEGIN
  ALTER TABLE "employee_supervisors" ADD CONSTRAINT "employee_supervisors_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "employee_supervisors" ADD CONSTRAINT "employee_supervisors_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
