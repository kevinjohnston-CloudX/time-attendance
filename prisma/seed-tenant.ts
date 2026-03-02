/**
 * One-time migration script: creates the default tenant and backfills
 * tenantId on all existing rows.
 *
 * Run with:  npx tsx prisma/seed-tenant.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  console.log("Creating default tenant…");

  // Use the first site's name as the tenant name, or fall back to a default
  const firstSite = await db.site.findFirst({ orderBy: { createdAt: "asc" } });
  const tenantName = firstSite?.name ?? "Default Organization";
  const tenantSlug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const existing = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (existing) {
    console.log(`Tenant already exists (id: ${existing.id}) — backfilling any nulls.`);
    await backfill(existing.id);
    return;
  }

  const tenant = await db.tenant.create({
    data: { name: tenantName, slug: tenantSlug },
  });
  console.log(`Created tenant: "${tenant.name}" (id: ${tenant.id}, slug: ${tenant.slug})`);

  await backfill(tenant.id);
}

async function backfill(tenantId: string) {
  const [sites, depts, emps, ruleSets, leaveTypes, payPeriods, auditLogs] = await Promise.all([
    db.site.updateMany({ where: { tenantId: null }, data: { tenantId } }),
    db.department.updateMany({ where: { tenantId: null }, data: { tenantId } }),
    db.employee.updateMany({ where: { tenantId: null }, data: { tenantId } }),
    db.ruleSet.updateMany({ where: { tenantId: null }, data: { tenantId } }),
    db.leaveType.updateMany({ where: { tenantId: null }, data: { tenantId } }),
    db.payPeriod.updateMany({ where: { tenantId: null }, data: { tenantId } }),
    db.auditLog.updateMany({ where: { tenantId: null }, data: { tenantId } }),
  ]);

  console.log("Backfill complete:");
  console.log(`  sites:      ${sites.count}`);
  console.log(`  departments:${depts.count}`);
  console.log(`  employees:  ${emps.count}`);
  console.log(`  ruleSets:   ${ruleSets.count}`);
  console.log(`  leaveTypes: ${leaveTypes.count}`);
  console.log(`  payPeriods: ${payPeriods.count}`);
  console.log(`  auditLogs:  ${auditLogs.count}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
