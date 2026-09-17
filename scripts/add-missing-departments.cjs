const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const MISSING_DEPARTMENTS = [
  "Packing", "Picking", "Receiving", "Vas", "Returns", "Storage", "Shipping",
  "Account Management", "Unassigned", "Maintenance", "Put Away", "Loss Prevention",
  "Human Resources And Talent Dev", "Kitting", "Business Development", "It",
  "Wms Support", "Facilities Maintenance", "Inventory Management", "Studio Operations",
  "Cycle Count", "Production Management", "Corporate Office", "Customer Experience",
  "Outbound", "Help Desk", "Billing", "Sales Development", "Inbound",
  "Operations Excellence", "Purchasing", "Marketing", "Finance Department",
  "Development", "Accounting", "Back Office", "Pick And Pack",
];

async function main() {
  // Get tenant ID and all site IDs
  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant found');
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const sites = await db.site.findMany({ select: { id: true, name: true } });
  console.log(`Sites (${sites.length}): ${sites.map(s => s.name).join(', ')}\n`);

  // Get existing departments to avoid duplicates
  const existing = await db.department.findMany({
    where: { tenantId: tenant.id },
    select: { name: true },
  });
  const existingNames = new Set(existing.map(d => d.name.toLowerCase()));

  let created = 0;
  let skipped = 0;

  for (const name of MISSING_DEPARTMENTS) {
    if (existingNames.has(name.toLowerCase())) {
      console.log(`  SKIP (already exists): ${name}`);
      skipped++;
      continue;
    }

    const dept = await db.department.create({
      data: {
        tenantId: tenant.id,
        name,
        isActive: true,
        sites: {
          create: sites.map(s => ({ siteId: s.id })),
        },
      },
    });

    console.log(`  + Created: ${name} → linked to ${sites.length} sites`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
