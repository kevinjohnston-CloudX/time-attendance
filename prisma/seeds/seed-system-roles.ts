/**
 * Seed script to create system roles for all tenants and link existing employees.
 *
 * Run: npx dotenvx run --env-file=.env.local -- npx tsx prisma/seeds/seed-system-roles.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

type PermissionEntry = { resource: string; action: string; scope: string };

const SYSTEM_ROLES: {
  name: string;
  description: string;
  rank: number;
  legacyRole: string;
  permissions: PermissionEntry[];
}[] = [
  {
    name: "Employee",
    description: "Basic employee — can punch, submit timesheets, request leave",
    rank: 0,
    legacyRole: "EMPLOYEE",
    permissions: [
      { resource: "punch", action: "write", scope: "own" },
      { resource: "timesheet", action: "write", scope: "own" },
      { resource: "leave", action: "write", scope: "own" },
      { resource: "document", action: "read", scope: "own" },
    ],
  },
  {
    name: "Supervisor",
    description: "Team lead — can view and edit team punches, approve timesheets and leave",
    rank: 1,
    legacyRole: "SUPERVISOR",
    permissions: [
      { resource: "punch", action: "write", scope: "own" },
      { resource: "punch", action: "read", scope: "team" },
      { resource: "punch", action: "write", scope: "team" },
      { resource: "timesheet", action: "write", scope: "own" },
      { resource: "timesheet", action: "execute", scope: "team" },
      { resource: "leave", action: "write", scope: "own" },
      { resource: "leave", action: "execute", scope: "team" },
      { resource: "document", action: "read", scope: "own" },
    ],
  },
  {
    name: "Payroll Admin",
    description: "Payroll administrator — manages pay periods, approves all timesheets, runs reports",
    rank: 2,
    legacyRole: "PAYROLL_ADMIN",
    permissions: [
      { resource: "punch", action: "write", scope: "all" },
      { resource: "punch", action: "read", scope: "all" },
      { resource: "timesheet", action: "write", scope: "own" },
      { resource: "timesheet", action: "execute", scope: "all" },
      { resource: "leave", action: "write", scope: "own" },
      { resource: "leave", action: "execute", scope: "all" },
      { resource: "payroll", action: "write", scope: "all" },
      { resource: "audit", action: "read", scope: "all" },
      { resource: "document", action: "write", scope: "own" },
      { resource: "document", action: "read", scope: "all" },
      { resource: "report", action: "read", scope: "all" },
      { resource: "report", action: "write", scope: "all" },
      { resource: "report", action: "execute", scope: "all" },
    ],
  },
  {
    name: "HR Admin",
    description: "HR administrator — manages employees, rules, sites, and all payroll functions",
    rank: 3,
    legacyRole: "HR_ADMIN",
    permissions: [
      { resource: "punch", action: "write", scope: "all" },
      { resource: "punch", action: "read", scope: "all" },
      { resource: "timesheet", action: "write", scope: "own" },
      { resource: "timesheet", action: "execute", scope: "all" },
      { resource: "leave", action: "write", scope: "own" },
      { resource: "leave", action: "execute", scope: "all" },
      { resource: "payroll", action: "write", scope: "all" },
      { resource: "employee", action: "write", scope: "all" },
      { resource: "employee", action: "read", scope: "all" },
      { resource: "rules", action: "write", scope: "all" },
      { resource: "rules", action: "read", scope: "all" },
      { resource: "site", action: "write", scope: "all" },
      { resource: "site", action: "read", scope: "all" },
      { resource: "audit", action: "read", scope: "all" },
      { resource: "document", action: "write", scope: "own" },
      { resource: "document", action: "read", scope: "all" },
      { resource: "report", action: "read", scope: "all" },
      { resource: "report", action: "write", scope: "all" },
      { resource: "report", action: "execute", scope: "all" },
    ],
  },
  {
    name: "System Admin",
    description: "Full system administrator — all permissions including role management",
    rank: 4,
    legacyRole: "SYSTEM_ADMIN",
    permissions: [
      { resource: "punch", action: "read", scope: "all" },
      { resource: "punch", action: "write", scope: "all" },
      { resource: "punch", action: "execute", scope: "all" },
      { resource: "timesheet", action: "read", scope: "all" },
      { resource: "timesheet", action: "write", scope: "all" },
      { resource: "timesheet", action: "execute", scope: "all" },
      { resource: "leave", action: "read", scope: "all" },
      { resource: "leave", action: "write", scope: "all" },
      { resource: "leave", action: "execute", scope: "all" },
      { resource: "payroll", action: "read", scope: "all" },
      { resource: "payroll", action: "write", scope: "all" },
      { resource: "payroll", action: "execute", scope: "all" },
      { resource: "employee", action: "read", scope: "all" },
      { resource: "employee", action: "write", scope: "all" },
      { resource: "employee", action: "execute", scope: "all" },
      { resource: "rules", action: "read", scope: "all" },
      { resource: "rules", action: "write", scope: "all" },
      { resource: "site", action: "read", scope: "all" },
      { resource: "site", action: "write", scope: "all" },
      { resource: "document", action: "read", scope: "all" },
      { resource: "document", action: "write", scope: "all" },
      { resource: "report", action: "read", scope: "all" },
      { resource: "report", action: "write", scope: "all" },
      { resource: "report", action: "execute", scope: "all" },
      { resource: "audit", action: "read", scope: "all" },
      { resource: "role", action: "read", scope: "all" },
      { resource: "role", action: "write", scope: "all" },
      { resource: "role", action: "execute", scope: "all" },
    ],
  },
];

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  console.log(`Found ${tenants.length} tenant(s)`);

  for (const tenant of tenants) {
    console.log(`\nProcessing tenant: ${tenant.name} (${tenant.id})`);

    for (const roleDef of SYSTEM_ROLES) {
      // Upsert the system role
      const existing = await prisma.customRole.findUnique({
        where: { tenantId_name: { tenantId: tenant.id, name: roleDef.name } },
      });

      let roleId: string;

      if (existing) {
        console.log(`  Role "${roleDef.name}" already exists, updating permissions...`);
        roleId = existing.id;

        // Replace permissions
        await prisma.rolePermission.deleteMany({ where: { customRoleId: roleId } });
      } else {
        console.log(`  Creating role "${roleDef.name}"...`);
        const role = await prisma.customRole.create({
          data: {
            tenantId: tenant.id,
            name: roleDef.name,
            description: roleDef.description,
            rank: roleDef.rank,
            isSystem: true,
          },
        });
        roleId = role.id;
      }

      // Create permissions
      await prisma.rolePermission.createMany({
        data: roleDef.permissions.map((p) => ({
          customRoleId: roleId,
          resource: p.resource,
          action: p.action,
          scope: p.scope,
        })),
        skipDuplicates: true,
      });

      // Link employees with matching legacy role
      const updated = await prisma.employee.updateMany({
        where: {
          tenantId: tenant.id,
          role: roleDef.legacyRole as "EMPLOYEE" | "SUPERVISOR" | "PAYROLL_ADMIN" | "HR_ADMIN" | "SYSTEM_ADMIN",
          customRoleId: null,
        },
        data: { customRoleId: roleId },
      });

      if (updated.count > 0) {
        console.log(`    Linked ${updated.count} ${roleDef.legacyRole} employee(s)`);
      }
    }
  }

  console.log("\nDone!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
