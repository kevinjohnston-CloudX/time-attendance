require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const sample = ['100248','100299','100428','630044','630240','901957'];
db.employee.findMany({ where: { employeeCode: { in: sample } }, select: { employeeCode: true, wmsId: true, user: { select: { name: true } } } })
  .then(rows => { rows.forEach(r => console.log(r.employeeCode, '| wmsId:', r.wmsId, '|', r.user.name)); })
  .finally(() => { db.$disconnect(); pool.end(); });
