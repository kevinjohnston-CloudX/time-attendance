-- Pay rates and pay on timecards become their own permission, Pay Rates Read
-- (pay:read:all, PAY_VIEW), so supervisors see and fix hours without seeing
-- what anyone earns. HR asked 11/17: HR Admin and Payroll Admin only. And HR
-- Admins get Roles & Permissions (role:write:all) to manage this themselves,
-- for roles below their own rank.
--
-- Additive: permission rows only. The code before this one never reads
-- pay:read:all, and its role:write check is the same one this grants, so
-- applying it ahead of the deploy gives HR Admins Roles & Permissions at once
-- and changes nothing else. Written to run more than once.
--
-- Undo:
--   DELETE FROM "role_permissions" WHERE "resource" = 'pay';
--   DELETE FROM "role_permissions" WHERE "resource" = 'role' AND "action" = 'write' AND "scope" = 'all'
--     AND "customRoleId" IN (SELECT id FROM "custom_roles" WHERE "isSystem" AND "name" = 'HR Admin');

INSERT INTO "role_permissions" ("id", "customRoleId", "resource", "action", "scope")
SELECT md5('pay_view_' || r.id), r.id, 'pay', 'read', 'all'
FROM   "custom_roles" r
WHERE  r."name" IN ('System Admin', 'HR Admin', 'Payroll Admin', 'Payroll Admin NL')
ON CONFLICT ("customRoleId", "resource", "action", "scope") DO NOTHING;

INSERT INTO "role_permissions" ("id", "customRoleId", "resource", "action", "scope")
SELECT md5('role_manage_' || r.id), r.id, 'role', 'write', 'all'
FROM   "custom_roles" r
WHERE  r."isSystem" AND r."name" = 'HR Admin'
ON CONFLICT ("customRoleId", "resource", "action", "scope") DO NOTHING;
