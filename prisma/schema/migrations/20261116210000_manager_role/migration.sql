-- The Manager role (src/lib/rbac/manager-role.ts): a supervisor who also
-- changes their people's timecards directly and approves supervisors' changes,
-- and may be given whole departments, sites, or both, on their employee record.
--
-- Additive: one new table, and a Manager role in each company that has none.
-- Nobody is put on the role. The code before this one never reads the table,
-- and treats the role as any other custom role at Supervisor's rank. Written
-- to run more than once, so it is a no-op where it was applied ahead of the
-- deploy.
--
-- Undo (moves nobody; take people off the role first):
--   DROP TABLE IF EXISTS "manager_department_access";
--   DELETE FROM "custom_roles" WHERE "isSystem" AND "name" = 'Manager'
--     AND NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."customRoleId" = "custom_roles".id);

CREATE TABLE IF NOT EXISTS "manager_department_access" (
  "id"           TEXT NOT NULL,
  "employeeId"   TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_department_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "manager_department_access_employeeId_departmentId_key"
  ON "manager_department_access" ("employeeId", "departmentId");

DO $$
BEGIN
  ALTER TABLE "manager_department_access" ADD CONSTRAINT "manager_department_access_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "manager_department_access" ADD CONSTRAINT "manager_department_access_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Supervisor's rank: role ranks are whole numbers and Payroll Admin is 2. It
-- is above Supervisor in what it may do, not in the number.
INSERT INTO "custom_roles" ("id", "tenantId", "name", "description", "isSystem", "rank", "canViewAs", "liveAttendanceOnly", "isActive", "createdAt", "updatedAt")
SELECT 'manager_' || t.id, t.id, 'Manager',
       'Supervisor who changes their people''s timecards directly and approves supervisors'' changes; may see whole departments or sites',
       true, 1, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM   "tenants" t
WHERE  NOT EXISTS (SELECT 1 FROM "custom_roles" r WHERE r."tenantId" = t.id AND r."name" = 'Manager');

-- Supervisor's permissions, and changing the team's punches and timecards.
INSERT INTO "role_permissions" ("id", "customRoleId", "resource", "action", "scope")
SELECT md5('manager_' || t.id || p.resource || p.action || p.scope), 'manager_' || t.id, p.resource, p.action, p.scope
FROM   "tenants" t
JOIN   "custom_roles" r ON r.id = 'manager_' || t.id
CROSS JOIN (VALUES
  ('punch', 'write', 'own'),
  ('punch', 'read', 'team'),
  ('punch', 'write', 'team'),
  ('punch', 'execute', 'team'),
  ('timecard', 'read', 'team'),
  ('timecard', 'write', 'team'),
  ('timesheet', 'write', 'own'),
  ('timesheet', 'execute', 'team'),
  ('leave', 'write', 'own'),
  ('leave', 'write', 'team'),
  ('leave', 'execute', 'team'),
  ('document', 'read', 'own'),
  ('accrual', 'read', 'own'),
  ('accrual', 'read', 'team')
) AS p(resource, action, scope)
ON CONFLICT ("customRoleId", "resource", "action", "scope") DO NOTHING;
