-- Pay rate history per employee, as NovaTime's Pay Rates table: an effective
-- date, Rate 1 (the pay rate), Rate 2 and Rate 3 (reference only) and a note.
-- employees."payRate" stays, and mirrors the Rate 1 in effect today.
--
-- Additive: a new table, nothing existing changes. Each employee with a pay
-- rate gets it as their first row, effective on their hire date. Written to
-- run more than once.
--
-- Undo: DROP TABLE IF EXISTS "employee_pay_rates";

CREATE TABLE IF NOT EXISTS "employee_pay_rates" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "rate1" DECIMAL(10,4) NOT NULL,
    "rate2" DECIMAL(10,4),
    "rate3" DECIMAL(10,4),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pay_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_pay_rates_employeeId_effectiveDate_key"
    ON "employee_pay_rates"("employeeId", "effectiveDate");

DO $$
BEGIN
  ALTER TABLE "employee_pay_rates" ADD CONSTRAINT "employee_pay_rates_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "employee_pay_rates" ("id", "employeeId", "effectiveDate", "rate1", "updatedAt")
SELECT 'epr_' || e."id", e."id", e."hireDate"::date, e."payRate", CURRENT_TIMESTAMP
FROM "employees" e
WHERE e."payRate" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Closed to Supabase's API roles like every other table (see
-- 20260928200000_lock_public_tables).
ALTER TABLE "employee_pay_rates" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "employee_pay_rates" FROM anon, authenticated;
