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
  return m ? { num: parseInt(m[1]), name: m[2].trim() } : { num: null, name: val.trim() };
}

async function main() {
  const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];

  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  // Collect unique values from XLS (active employees only)
  const xlsLocations = new Map();
  const xlsDepartments = new Map();
  const xlsShifts = new Map();
  const xlsPayPolicies = new Map();
  const xlsHolidayRules = new Map();
  const xlsPayCategories = new Map();
  const xlsPayTypes = new Map();

  let activeCount = 0, inactiveCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const status = row[idx['Employee Status']];
    if (status === 'I') { inactiveCount++; continue; }
    activeCount++;

    const loc = parseBracket(row[idx['Location(G1)']]);
    const dept = parseBracket(row[idx['Department(G2)']]);
    const shift = parseBracket(row[idx['Shift Number']]);
    const policy = parseBracket(row[idx['Pay Policy']]);
    const holiday = parseBracket(row[idx['Holiday Rule']]);
    const paycat = parseBracket(row[idx['Pay Category']]);
    const paytype = parseBracket(row[idx['Pay Type']]);

    if (loc?.name) xlsLocations.set(loc.name, (xlsLocations.get(loc.name) || 0) + 1);
    if (dept?.name) xlsDepartments.set(dept.name, (xlsDepartments.get(dept.name) || 0) + 1);
    if (shift?.name) xlsShifts.set(shift.name, (xlsShifts.get(shift.name) || 0) + 1);
    if (policy?.name) xlsPayPolicies.set(policy.name, (xlsPayPolicies.get(policy.name) || 0) + 1);
    if (holiday?.name) xlsHolidayRules.set(holiday.name, (xlsHolidayRules.get(holiday.name) || 0) + 1);
    if (paycat?.name) xlsPayCategories.set(paycat.name, (xlsPayCategories.get(paycat.name) || 0) + 1);
    if (paytype?.name) xlsPayTypes.set(paytype.name, (xlsPayTypes.get(paytype.name) || 0) + 1);
  }

  console.log(`\nXLS: ${activeCount} active employees, ${inactiveCount} inactive\n`);

  // Query DB
  const [dbSites, dbDepts, dbShifts, dbRulesets, dbHolidays, dbPayCats, dbPayTypes] = await Promise.all([
    db.site.findMany({ select: { name: true } }),
    db.department.findMany({ select: { name: true } }),
    db.shift.findMany({ select: { name: true } }),
    db.ruleSet.findMany({ select: { name: true } }),
    db.holidayRule.findMany({ select: { name: true } }),
    db.payCategory.findMany({ select: { number: true, description: true } }),
    db.payType.findMany({ select: { number: true, description: true } }).catch(() => []),
  ]);

  const dbSiteNames = new Set(dbSites.map(s => s.name.toLowerCase()));
  const dbDeptNames = new Set(dbDepts.map(d => d.name.toLowerCase()));
  const dbShiftNames = new Set(dbShifts.map(s => s.name.toLowerCase()));
  const dbRulesetNames = new Set(dbRulesets.map(r => r.name.toLowerCase()));
  const dbHolidayNames = new Set(dbHolidays.map(h => h.name.toLowerCase()));
  const dbPayCatNumbers = new Set(dbPayCats.map(p => p.number));
  const dbPayTypeNumbers = new Set(dbPayTypes.map(p => p.number));

  function printMissing(label, xlsMap, dbSet) {
    const missing = [];
    const found = [];
    for (const [name, count] of [...xlsMap.entries()].sort((a,b) => b[1]-a[1])) {
      if (!dbSet.has(name.toLowerCase())) missing.push({ name, count });
      else found.push({ name, count });
    }
    console.log(`\n=== ${label} ===`);
    if (missing.length === 0) {
      console.log('  ✓ All present in DB');
    } else {
      console.log(`  MISSING (${missing.length} of ${xlsMap.size}):`);
      missing.forEach(m => console.log(`    - "${m.name}"  (${m.count} employees)`));
    }
    if (found.length > 0) {
      console.log(`  Present (${found.length}):`);
      found.forEach(f => console.log(`    ✓ "${f.name}"  (${f.count})`));
    }
  }

  printMissing('SITES (Location G1)', xlsLocations, dbSiteNames);
  printMissing('DEPARTMENTS (G2)', xlsDepartments, dbDeptNames);
  printMissing('SHIFTS', xlsShifts, dbShiftNames);
  printMissing('RULE SETS (Pay Policy)', xlsPayPolicies, dbRulesetNames);
  printMissing('HOLIDAY RULES', xlsHolidayRules, dbHolidayNames);

  // Pay categories/types matched by number
  function printMissingByNumber(label, xlsMap, dbNumbers, dbItems) {
    const missing = [];
    const found = [];
    for (const [name, count] of [...xlsMap.entries()].sort((a,b) => b[1]-a[1])) {
      const num = parseInt(name);
      if (!dbNumbers.has(num)) missing.push({ name, count });
      else {
        const desc = dbItems.find(p => p.number === num)?.description ?? '';
        found.push({ name, count, desc });
      }
    }
    console.log(`\n=== ${label} ===`);
    if (missing.length === 0) {
      console.log('  ✓ All present in DB');
    } else {
      console.log(`  MISSING (${missing.length} of ${xlsMap.size}):`);
      missing.forEach(m => console.log(`    - #${m.name}  "${m.name}"  (${m.count} employees)`));
    }
    if (found.length > 0) {
      console.log(`  Present (${found.length}):`);
      found.forEach(f => console.log(`    ✓ #${f.name} "${f.desc}"  (${f.count})`));
    }
  }

  // XLS Pay Category format: "25 [Pa Temp]" — key stored is the name inside brackets
  // But we need to match by the number prefix. Re-parse from raw.
  // Actually xlsPayCategories keys are names, so re-collect by number:
  const xlsPayCatByNum = new Map();
  const xlsPayTypeByNum = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[idx['Employee Status']] === 'I') continue;
    const paycat = parseBracket(row[idx['Pay Category']]);
    const paytype = parseBracket(row[idx['Pay Type']]);
    if (paycat?.num != null) {
      const key = String(paycat.num);
      xlsPayCatByNum.set(key, (xlsPayCatByNum.get(key) || 0) + 1);
    }
    if (paytype?.num != null) {
      const key = String(paytype.num);
      xlsPayTypeByNum.set(key, (xlsPayTypeByNum.get(key) || 0) + 1);
    }
  }

  printMissingByNumber('PAY CATEGORIES (matched by number)', xlsPayCatByNum, dbPayCatNumbers, dbPayCats);
  printMissingByNumber('PAY TYPES (matched by number)', xlsPayTypeByNum, dbPayTypeNumbers, dbPayTypes);

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
