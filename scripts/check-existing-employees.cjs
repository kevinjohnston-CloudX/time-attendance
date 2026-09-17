const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

function parseBracket(val) {
  if (!val || typeof val !== 'string') return null;
  const m = val.match(/^(\d+)\s*\[(.+)\]$/);
  return m ? m[2].trim() : val.trim();
}

async function main() {
  const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  // Collect active employees from XLS
  const xlsEmployees = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[idx['Employee Status']] !== 'A') continue;
    const badge = row[idx['Badge Number']];
    const badgeStr = String(badge).trim();
    xlsEmployees.push({
      empId: String(row[idx['Employee ID']]).trim(),
      name: row[idx['Full Name']],
      site: parseBracket(row[idx['Location(G1)']]),
      wmsId: (badgeStr === '0' || badgeStr === '') ? null : badgeStr,
    });
  }

  // Get all employees already in the system
  const existing = await db.employee.findMany({
    select: { employeeCode: true, wmsId: true, user: { select: { name: true } } },
  });
  const existingCodes = new Map(existing.map(e => [e.employeeCode, e.user?.name]));
  const existingWmsIds = new Map(
    existing.filter(e => e.wmsId).map(e => [e.wmsId, e.user?.name])
  );

  const alreadyIn = [];
  const notIn = [];

  for (const emp of xlsEmployees) {
    const matchByCode = existingCodes.has(emp.empId);
    const matchByWms = emp.wmsId && existingWmsIds.has(emp.wmsId);

    if (matchByCode || matchByWms) {
      alreadyIn.push({
        ...emp,
        systemName: existingCodes.get(emp.empId) ?? existingWmsIds.get(emp.wmsId),
        matchedBy: matchByCode && matchByWms ? 'both' : matchByCode ? 'employeeCode' : 'wmsId',
      });
    } else {
      notIn.push(emp);
    }
  }

  console.log(`\nXLS active employees: ${xlsEmployees.length}`);
  console.log(`Already in system:    ${alreadyIn.length}`);
  console.log(`Need to import:       ${notIn.length}`);

  if (alreadyIn.length > 0) {
    console.log('\n=== Already in system ===');
    alreadyIn.forEach(e =>
      console.log(`  ${e.empId.padEnd(10)} ${e.name.padEnd(30)} wmsId: ${e.wmsId ?? 'null'}  matched by: ${e.matchedBy}  (system: ${e.systemName})`)
    );
  }

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
