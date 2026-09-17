/**
 * Compare the 35 already-in-system employees against the XLS to find mismatches.
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

function parseDate(val) {
  if (!val || val === '') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d) return 'null';
  return new Date(d).toISOString().split('T')[0];
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

async function main() {
  const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  // Load DB lookup maps
  const [sites, depts, shifts, rulesets, holidayRules, payCategories, payTypes] = await Promise.all([
    db.site.findMany({ select: { id: true, name: true } }),
    db.department.findMany({ select: { id: true, name: true } }),
    db.shift.findMany({ select: { id: true, name: true } }),
    db.ruleSet.findMany({ select: { id: true, name: true } }),
    db.holidayRule.findMany({ select: { id: true, name: true } }),
    db.payCategory.findMany({ select: { id: true, number: true } }),
    db.payType.findMany({ select: { id: true, number: true } }),
  ]);

  const siteById    = new Map(sites.map(s => [s.id, s.name]));
  const deptById    = new Map(depts.map(d => [d.id, d.name]));
  const shiftById   = new Map(shifts.map(s => [s.id, s.name]));
  const rulesetById = new Map(rulesets.map(r => [r.id, r.name]));
  const holidayById = new Map(holidayRules.map(h => [h.id, h.name]));
  const payCatById  = new Map(payCategories.map(p => [p.id, p.number]));
  const payTypeById = new Map(payTypes.map(p => [p.id, p.number]));

  const siteMap     = new Map(sites.map(s => [s.name.toLowerCase(), s.id]));
  const deptMap     = new Map(depts.map(d => [d.name.toLowerCase(), d.id]));
  const shiftMap    = new Map(shifts.map(s => [s.name.toLowerCase(), s.id]));
  const rulesetMap  = new Map(rulesets.map(r => [r.name.toLowerCase(), r.id]));
  const holidayMap  = new Map(holidayRules.map(h => [h.name.toLowerCase(), h.id]));
  const payCatMap   = new Map(payCategories.map(p => [p.number, p.id]));
  const payTypeMap  = new Map(payTypes.map(p => [p.number, p.id]));

  // Load existing employees from DB
  const existingEmps = await db.employee.findMany({
    select: {
      employeeCode: true, wmsId: true, isActive: true, onLeave: true,
      jobTitle: true, hireDate: true, payType: true, payRate: true,
      siteId: true, departmentId: true, shiftId: true, ruleSetId: true,
      holidayRuleId: true, payCategoryId: true, payTypeId: true,
      user: { select: { name: true, email: true } },
    },
  });

  const existingByCode  = new Map(existingEmps.map(e => [e.employeeCode, e]));
  const existingByWmsId = new Map(existingEmps.filter(e => e.wmsId).map(e => [e.wmsId, e]));

  const mismatches = [];
  const matched = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const empId    = String(row[idx['Employee ID']]).trim();
    const badge    = row[idx['Badge Number']];
    const badgeStr = String(badge).trim();
    const wmsId    = (badgeStr === '0' || badgeStr === '') ? null : badgeStr;

    const dbEmp = existingByCode.get(empId) ?? (wmsId ? existingByWmsId.get(wmsId) : null);
    if (!dbEmp) continue; // not in system, was imported — skip

    matched.push(empId);

    const xlsName    = formatName(row[idx['Full Name']]);
    const xlsStatus  = row[idx['Employee Status']];
    const { isActive: xlsActive, onLeave: xlsLeave } = statusToFlags(xlsStatus);

    const siteName    = parseBracket(row[idx['Location(G1)']]).name;
    const deptName    = parseBracket(row[idx['Department(G2)']]).name;
    const shiftName   = parseBracket(row[idx['Shift Number']]).name;
    const rulesetName = parseBracket(row[idx['Pay Policy']]).name;
    const holidayName = parseBracket(row[idx['Holiday Rule']]).name;
    const payCatNum   = parseBracket(row[idx['Pay Category']]).num;
    const payTypeNum  = parseBracket(row[idx['Pay Type']]).num;

    const xlsSiteId      = siteName    ? siteMap.get(siteName.toLowerCase())    : null;
    const xlsDeptId      = deptName    ? deptMap.get(deptName.toLowerCase())    : null;
    const xlsShiftId     = shiftName   ? shiftMap.get(shiftName.toLowerCase())  : null;
    const xlsRuleSetId   = rulesetName ? rulesetMap.get(rulesetName.toLowerCase()) : null;
    const xlsHolidayId   = holidayName ? holidayMap.get(holidayName.toLowerCase()) : null;
    const xlsPayCatId    = payCatNum != null ? payCatMap.get(payCatNum) : null;
    const xlsPayTypeId   = payTypeNum != null ? payTypeMap.get(payTypeNum) : null;

    const xlsHireDate  = parseDate(row[idx['Hire Date']]);
    const xlsJobTitle  = row[idx['Job Title']]?.trim() || null;
    const xlsWmsId     = wmsId;

    const diffs = [];

    if (dbEmp.user?.name !== xlsName)
      diffs.push(`name: DB="${dbEmp.user?.name}" XLS="${xlsName}"`);
    if (dbEmp.isActive !== xlsActive)
      diffs.push(`isActive: DB=${dbEmp.isActive} XLS=${xlsActive} (status=${xlsStatus})`);
    if (dbEmp.onLeave !== xlsLeave)
      diffs.push(`onLeave: DB=${dbEmp.onLeave} XLS=${xlsLeave}`);
    if (dbEmp.wmsId !== xlsWmsId)
      diffs.push(`wmsId: DB="${dbEmp.wmsId}" XLS="${xlsWmsId}"`);
    if (xlsSiteId && dbEmp.siteId !== xlsSiteId)
      diffs.push(`site: DB="${siteById.get(dbEmp.siteId)}" XLS="${siteName}"`);
    if (xlsDeptId && dbEmp.departmentId !== xlsDeptId)
      diffs.push(`dept: DB="${deptById.get(dbEmp.departmentId)}" XLS="${deptName}"`);
    if (xlsShiftId && dbEmp.shiftId !== xlsShiftId)
      diffs.push(`shift: DB="${shiftById.get(dbEmp.shiftId)}" XLS="${shiftName}"`);
    if (xlsRuleSetId && dbEmp.ruleSetId !== xlsRuleSetId)
      diffs.push(`ruleset: DB="${rulesetById.get(dbEmp.ruleSetId)}" XLS="${rulesetName}"`);
    if (xlsHolidayId && dbEmp.holidayRuleId !== xlsHolidayId)
      diffs.push(`holidayRule: DB="${holidayById.get(dbEmp.holidayRuleId)}" XLS="${holidayName}"`);
    if (xlsPayCatId && dbEmp.payCategoryId !== xlsPayCatId)
      diffs.push(`payCategory: DB="${payCatById.get(dbEmp.payCategoryId)}" XLS="${payCatNum}"`);
    if (xlsJobTitle && dbEmp.jobTitle !== xlsJobTitle)
      diffs.push(`jobTitle: DB="${dbEmp.jobTitle}" XLS="${xlsJobTitle}"`);
    if (xlsHireDate && fmtDate(dbEmp.hireDate) !== fmtDate(xlsHireDate))
      diffs.push(`hireDate: DB=${fmtDate(dbEmp.hireDate)} XLS=${fmtDate(xlsHireDate)}`);

    if (diffs.length > 0) {
      mismatches.push({ empId, name: xlsName, diffs });
    }
  }

  console.log(`\nChecked ${matched.length} skipped employees against XLS.\n`);

  if (mismatches.length === 0) {
    console.log('All match — no discrepancies found.');
  } else {
    console.log(`${mismatches.length} employees have discrepancies:\n`);
    mismatches.forEach(({ empId, name, diffs }) => {
      console.log(`  ${empId} ${name}`);
      diffs.forEach(d => console.log(`    ${d}`));
    });
  }

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
