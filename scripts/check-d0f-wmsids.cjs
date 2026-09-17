require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  // Employees whose employeeCode starts with D0F
  const emps = await db.employee.findMany({
    where: { employeeCode: { startsWith: 'D0F' } },
    select: { employeeCode: true, wmsId: true, user: { select: { name: true } } },
    take: 20,
  });
  console.log('employeeCode            wmsId (exact stored value)    name');
  emps.forEach(e => console.log(
    String(e.employeeCode).padEnd(24),
    String(e.wmsId ?? 'null').padEnd(30),
    e.user.name
  ));

  const withWms = emps.filter(e => e.wmsId);
  const withoutWms = emps.filter(e => !e.wmsId);
  console.log(`\nD0F employees with wmsId: ${withWms.length}`);
  console.log(`D0F employees with null wmsId: ${withoutWms.length}`);
}

main().finally(() => { db.$disconnect(); pool.end(); });
