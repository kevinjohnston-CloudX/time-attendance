-- Hours entered with Add time (no clock times) are a clock in at 12:00 AM and
-- a clock out that many hours later. Marked, the meal rules leave them alone:
-- 8 hours entered was paid 7.5 on a shift that takes its meal automatically
-- (Karla Hernandez 10/12, Rola Allam 10/20).
--
-- Additive, with a default, so the code still serving during the build is
-- unaffected. Written to run more than once.
--
-- Undo:
--   ALTER TABLE "punches" DROP COLUMN IF EXISTS "hoursOnly";

ALTER TABLE "punches" ADD COLUMN IF NOT EXISTS "hoursOnly" BOOLEAN NOT NULL DEFAULT false;

-- The hours already entered this way. Found by the audit log, which records
-- every Add time hours entry with its day: the punch's own note is the
-- note HR typed, when they typed one, so it cannot be relied on. The clock
-- in is a hand entered one at 12:00 AM in the employee's time zone; the clock
-- out was saved in the same transaction, within a few seconds of it.
WITH ins AS (
  SELECT p.id, p."employeeId", p."timesheetId", p."punchTime", p."createdAt"
  FROM "punches" p
  JOIN "employees" e ON e.id = p."employeeId"
  JOIN "sites" s ON s.id = e."siteId"
  WHERE p.source = 'MANUAL' AND p."punchType" = 'CLOCK_IN' AND p."isApproved" AND p."approvedById" IS NOT NULL
    AND ((p."punchTime" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(e."timeZone", s.timezone))::time = '00:00:00'
    AND EXISTS (
      SELECT 1 FROM "audit_logs" a
      WHERE a."entityType" = 'TIMESHEET' AND a."entityId" = p."timesheetId"
        AND a.changes -> 'after' ->> 'source' = 'MANUAL_HOURS'
        AND a.changes -> 'after' ->> 'date' = to_char((p."punchTime" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(e."timeZone", s.timezone), 'YYYY-MM-DD')
        AND a."createdAt" BETWEEN p."createdAt" - interval '10 seconds' AND p."createdAt" + interval '10 seconds'
    )
),
outs AS (
  SELECT o.id
  FROM ins
  JOIN LATERAL (
    SELECT q.id FROM "punches" q
    WHERE q."employeeId" = ins."employeeId" AND q."timesheetId" = ins."timesheetId"
      AND q.source = 'MANUAL' AND q."punchType" = 'CLOCK_OUT' AND q."isApproved" AND q."punchTime" > ins."punchTime"
      AND q."createdAt" BETWEEN ins."createdAt" AND ins."createdAt" + interval '10 seconds'
    ORDER BY q."punchTime" LIMIT 1
  ) o ON true
)
UPDATE "punches" SET "hoursOnly" = true
WHERE id IN (SELECT id FROM ins) OR id IN (SELECT id FROM outs);
