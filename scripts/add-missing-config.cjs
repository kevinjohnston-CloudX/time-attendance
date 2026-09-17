const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  const tenant = await db.tenant.findFirst({ select: { id: true } });
  const tenantId = tenant.id;

  const allSites = await db.site.findMany({ select: { id: true, name: true } });

  // ── 1. Missing departments ────────────────────────────────────────────────
  const missingDepts = ['Accounts Payable', 'Caja', 'Fpa', 'Cleaning', 'Quality'];
  const existingDepts = await db.department.findMany({ where: { tenantId }, select: { name: true } });
  const existingDeptNames = new Set(existingDepts.map(d => d.name.toLowerCase()));

  for (const name of missingDepts) {
    if (existingDeptNames.has(name.toLowerCase())) {
      console.log(`  SKIP dept (exists): ${name}`);
      continue;
    }
    await db.department.create({
      data: {
        tenantId,
        name,
        isActive: true,
        sites: { create: allSites.map(s => ({ siteId: s.id })) },
      },
    });
    console.log(`  + Dept: ${name} → linked to ${allSites.length} sites`);
  }

  // ── 2. Missing site: 1925 Kennesaw (Georgia → America/New_York) ──────────
  const existingSite = await db.site.findFirst({ where: { tenantId, name: '1925 Kennesaw' } });
  if (existingSite) {
    console.log(`  SKIP site (exists): 1925 Kennesaw`);
  } else {
    const newSite = await db.site.create({
      data: { tenantId, name: '1925 Kennesaw', timezone: 'America/New_York', isActive: true },
    });
    // Link all existing departments to the new site
    const allDepts = await db.department.findMany({ where: { tenantId }, select: { id: true } });
    await db.departmentSite.createMany({
      data: allDepts.map(d => ({ departmentId: d.id, siteId: newSite.id })),
      skipDuplicates: true,
    });
    console.log(`  + Site: 1925 Kennesaw (America/New_York) → linked to ${allDepts.length} departments`);
  }

  // ── 3. Missing rulesets ───────────────────────────────────────────────────
  const missingRulesets = [
    { name: 'Unassigned',       number: null },
    { name: 'Ca Exempt - Punch', number: null },
  ];

  const existingRulesets = await db.ruleSet.findMany({ where: { tenantId }, select: { name: true } });
  const existingRulesetNames = new Set(existingRulesets.map(r => r.name.toLowerCase()));

  for (const rs of missingRulesets) {
    if (existingRulesetNames.has(rs.name.toLowerCase())) {
      console.log(`  SKIP ruleset (exists): ${rs.name}`);
      continue;
    }
    await db.ruleSet.create({
      data: { tenantId, name: rs.name },
    });
    console.log(`  + Ruleset: ${rs.name}`);
  }

  console.log('\nDone.');
  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
