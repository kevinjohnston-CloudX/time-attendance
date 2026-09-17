/**
 * Update the 35 pre-existing employees to match XLS data:
 *   - Job titles (null → XLS value)
 *   - Departments (old verbose names → XLS simple names)
 *   - Status: deactivate Ana Galdamez (601611)
 *   - Ruleset / holiday rule / pay category for 601611
 *   - Name fixes: Earl Jr, Patricia Elayne, John Raefski (strip "2")
 *
 * Skips:
 *   - Hire dates (XLS 2023-01-02 is a NovaTime placeholder)
 *   - Site changes (admin/test accounts have intentional site overrides)
 *   - wmsId changes
 */

const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

function parseBracket(val) {
  if (!val || typeof val !== 'string') return { num: null, name: null };
  const m = val.match(/^(\d+)\s*\[(.+)\]$/);
  return m ? { num: parseInt(m[1]), name: m[2].trim() } : { num: null, name: val.trim() };
}

function formatName(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  const parts = raw.split(',');
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
  return raw.trim();
}

function statusToFlags(status) {
  switch (status) {
    case 'A': return { isActive: true,  onLeave: false };
    case 'I': return { isActive: false, onLeave: false };
    case 'L':
    case 'S': return { isActive: true,  onLeave: true  };
    default:  return { isActive: false, onLeave: false };
  }
}

// Names that should be fixed regardless of XLS (DB had wrong values)
const NAME_FIXES = {
  '119517': 'John Raefski',          // had trailing "2"
  '604423': 'Earl McKinney Jr',      // was missing "Jr"
  '609596': 'Patricia Elayne Richey', // was missing middle name
};

async function main() {
  console.log('\n=== UPDATE PRE-EXISTING EMPLOYEES ===\n');

  const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  // Load lookup maps
  const [depts, rulesets, holidayRules, payCategories, existingEmps] = await Promise.all([
    db.department.findMany({ select: { id: true, name: true } }),
    db.ruleSet.findMany({ select: { id: true, name: true } }),
    db.holidayRule.findMany({ select: { id: true, name: true } }),
    db.payCategory.findMany({ select: { id: true, number: true } }),
    db.employee.findMany({
      select: { id: true, employeeCode: true, wmsId: true, userId: true,
                jobTitle: true, departmentId: true, ruleSetId: true,
                holidayRuleId: true, payCategoryId: true, isActive: true, onLeave: true },
    }),
  ]);

  const deptMap     = new Map(depts.map(d => [d.name.toLowerCase(), d.id]));
  const rulesetMap  = new Map(rulesets.map(r => [r.name.toLowerCase(), r.id]));
  const holidayMap  = new Map(holidayRules.map(h => [h.name.toLowerCase(), h.id]));
  const payCatMap   = new Map(payCategories.map(p => [p.number, p.id]));

  const existingByCode  = new Map(existingEmps.map(e => [e.employeeCode, e]));
  const existingByWmsId = new Map(existingEmps.filter(e => e.wmsId).map(e => [e.wmsId, e]));

  let updated = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const empId    = String(row[idx['Employee ID']]).trim();
    const badge    = row[idx['Badge Number']];
    const badgeStr = String(badge).trim();
    const wmsId    = (badgeStr === '0' || badgeStr === '') ? null : badgeStr;

    const dbEmp = existingByCode.get(empId) ?? (wmsId ? existingByWmsId.get(wmsId) : null);
    if (!dbEmp) continue; // was imported in the main run — skip

    const xlsStatus  = row[idx['Employee Status']];
    const { isActive: xlsActive, onLeave: xlsLeave } = statusToFlags(xlsStatus);
    const deptName   = parseBracket(row[idx['Department(G2)']]).name;
    const rulesetName = parseBracket(row[idx['Pay Policy']]).name;
    const holidayName = parseBracket(row[idx['Holiday Rule']]).name;
    const payCatNum  = parseBracket(row[idx['Pay Category']]).num;
    const xlsJobTitle = row[idx['Job Title']]?.trim() || null;

    const xlsDeptId      = deptName    ? deptMap.get(deptName.toLowerCase())    : null;
    const xlsRuleSetId   = rulesetName ? rulesetMap.get(rulesetName.toLowerCase()) : null;
    const xlsHolidayId   = holidayName ? holidayMap.get(holidayName.toLowerCase()) : null;
    const xlsPayCatId    = payCatNum != null ? payCatMap.get(payCatNum) : null;

    const empUpdates = {};
    const userUpdates = {};
    const changes = [];

    // Department
    if (xlsDeptId && dbEmp.departmentId !== xlsDeptId) {
      empUpdates.departmentId = xlsDeptId;
      changes.push(`dept → ${deptName}`);
    }

    // Job title (only update if XLS has a value)
    if (xlsJobTitle && dbEmp.jobTitle !== xlsJobTitle) {
      empUpdates.jobTitle = xlsJobTitle;
      changes.push(`jobTitle → "${xlsJobTitle}"`);
    }

    // Status (only update if different)
    if (dbEmp.isActive !== xlsActive || dbEmp.onLeave !== xlsLeave) {
      empUpdates.isActive = xlsActive;
      empUpdates.onLeave  = xlsLeave;
      changes.push(`status → isActive=${xlsActive} onLeave=${xlsLeave} (${xlsStatus})`);
    }

    // Ruleset (only update if XLS has one)
    if (xlsRuleSetId && dbEmp.ruleSetId !== xlsRuleSetId) {
      empUpdates.ruleSetId = xlsRuleSetId;
      changes.push(`ruleset → ${rulesetName}`);
    }

    // Holiday rule
    if (xlsHolidayId && dbEmp.holidayRuleId !== xlsHolidayId) {
      empUpdates.holidayRuleId = xlsHolidayId;
      changes.push(`holidayRule → ${holidayName}`);
    }

    // Pay category
    if (xlsPayCatId && dbEmp.payCategoryId !== xlsPayCatId) {
      empUpdates.payCategoryId = xlsPayCatId;
      changes.push(`payCategory → ${payCatNum}`);
    }

    // Name fixes
    const fixedName = NAME_FIXES[empId];
    if (fixedName) {
      userUpdates.name = fixedName;
      changes.push(`name → "${fixedName}"`);
    }

    if (Object.keys(empUpdates).length === 0 && Object.keys(userUpdates).length === 0) continue;

    try {
      await db.$transaction(async (tx) => {
        if (Object.keys(empUpdates).length > 0) {
          await tx.employee.update({ where: { id: dbEmp.id }, data: empUpdates });
        }
        if (Object.keys(userUpdates).length > 0) {
          await tx.user.update({ where: { id: dbEmp.userId }, data: userUpdates });
        }
      });
      updated++;
      console.log(`  ${empId.padEnd(10)} ${String(row[idx['Full Name']]).padEnd(35)} — ${changes.join(', ')}`);
    } catch (e) {
      console.error(`  FAILED: ${empId} — ${e.message.split('\n')[0]}`);
    }
  }

  console.log(`\nDone: ${updated} employees updated.`);
  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
