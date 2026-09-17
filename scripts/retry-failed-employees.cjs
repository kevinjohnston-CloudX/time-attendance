/**
 * Retry the 116 employees that failed due to email uniqueness conflicts.
 * For each, if the real email is already in use, fall back to emp-{empId}@noreply.local.
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

function parseDate(val) {
  if (!val || val === '') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toPayType(val) {
  const name = parseBracket(val).name?.toLowerCase() ?? '';
  if (name.includes('salary') || name.includes('exempt')) return 'SALARY';
  return 'HOURLY';
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

function formatName(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  const parts = raw.split(',');
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
  return raw.trim();
}

async function main() {
  console.log('\n=== RETRY FAILED EMPLOYEES ===');

  const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant found');

  const [sites, depts, shifts, rulesets, holidayRules, payCategories, payTypes, existingEmps, existingUsers] = await Promise.all([
    db.site.findMany({ select: { id: true, name: true } }),
    db.department.findMany({ select: { id: true, name: true } }),
    db.shift.findMany({ select: { id: true, name: true } }),
    db.ruleSet.findMany({ select: { id: true, name: true } }),
    db.holidayRule.findMany({ select: { id: true, name: true } }),
    db.payCategory.findMany({ select: { id: true, number: true } }),
    db.payType.findMany({ select: { id: true, number: true } }),
    db.employee.findMany({ select: { employeeCode: true, wmsId: true } }),
    db.user.findMany({ select: { email: true } }),
  ]);

  const siteMap      = new Map(sites.map(s => [s.name.toLowerCase(), s.id]));
  const deptMap      = new Map(depts.map(d => [d.name.toLowerCase(), d.id]));
  const shiftMap     = new Map(shifts.map(s => [s.name.toLowerCase(), s.id]));
  const rulesetMap   = new Map(rulesets.map(r => [r.name.toLowerCase(), r.id]));
  const holidayMap   = new Map(holidayRules.map(h => [h.name.toLowerCase(), h.id]));
  const payCatMap    = new Map(payCategories.map(p => [p.number, p.id]));
  const payTypeMap   = new Map(payTypes.map(p => [p.number, p.id]));

  const existingCodes  = new Set(existingEmps.map(e => e.employeeCode));
  const existingWmsIds = new Set(existingEmps.filter(e => e.wmsId).map(e => e.wmsId));
  const takenEmails    = new Set(existingUsers.map(u => u.email?.toLowerCase()).filter(Boolean));

  let imported = 0, failed = 0, skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const empId    = String(row[idx['Employee ID']]).trim();
    const status   = row[idx['Employee Status']];
    const badge    = row[idx['Badge Number']];
    const badgeStr = String(badge).trim();
    const wmsId    = (badgeStr === '0' || badgeStr === '') ? null : badgeStr;

    // Skip if already successfully imported
    if (existingCodes.has(empId) || (wmsId && existingWmsIds.has(wmsId))) {
      skipped++;
      continue;
    }

    const { isActive, onLeave } = statusToFlags(status);

    const siteName    = parseBracket(row[idx['Location(G1)']]).name;
    const deptName    = parseBracket(row[idx['Department(G2)']]).name;
    const shiftName   = parseBracket(row[idx['Shift Number']]).name;
    const rulesetName = parseBracket(row[idx['Pay Policy']]).name;
    const holidayName = parseBracket(row[idx['Holiday Rule']]).name;
    const payCatNum   = parseBracket(row[idx['Pay Category']]).num;
    const payTypeNum  = parseBracket(row[idx['Pay Type']]).num;

    const siteId      = siteName    ? siteMap.get(siteName.toLowerCase())    : null;
    const deptId      = deptName    ? deptMap.get(deptName.toLowerCase())    : null;
    const shiftId     = shiftName   ? shiftMap.get(shiftName.toLowerCase())  : null;
    const ruleSetId   = rulesetName ? rulesetMap.get(rulesetName.toLowerCase()) : null;
    const holidayRuleId = holidayName ? holidayMap.get(holidayName.toLowerCase()) : null;
    const payCategoryId = payCatNum != null ? payCatMap.get(payCatNum) : null;
    const payTypeId     = payTypeNum != null ? payTypeMap.get(payTypeNum) : null;

    if (!siteId || !deptId || !ruleSetId) continue;

    const rawName = row[idx['Full Name']];
    const name    = formatName(rawName);

    // Email strategy: try real email, fall back to placeholder if taken
    const realEmail = row[idx['Email Address']]?.trim() || null;
    let email;
    if (realEmail && !takenEmails.has(realEmail.toLowerCase())) {
      email = realEmail;
    } else {
      // Use placeholder (guaranteed unique by empId)
      email = `emp-${empId}@noreply.local`;
      if (takenEmails.has(email.toLowerCase())) {
        // Already imported under a different path — skip
        skipped++;
        continue;
      }
    }

    const chargeRate = row[idx['Charge Rate']];
    const payRate = (chargeRate && chargeRate !== 0) ? chargeRate : null;

    try {
      await db.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { name, email } });

        await tx.employee.create({
          data: {
            tenantId:     tenant.id,
            userId:       user.id,
            employeeCode: empId,
            wmsId,
            isActive,
            onLeave,
            siteId,
            departmentId: deptId,
            ruleSetId,
            shiftId:      shiftId ?? undefined,
            holidayRuleId:  holidayRuleId ?? undefined,
            payCategoryId:  payCategoryId ?? undefined,
            payTypeId:      payTypeId ?? undefined,
            payType:        toPayType(row[idx['Pay Method']]),
            payRate,
            jobTitle:       row[idx['Job Title']]?.trim() || null,
            hireDate:       parseDate(row[idx['Hire Date']]) ?? new Date('1970-01-01'),
            adjustedHireDate: parseDate(row[idx['Adjusted Hire Date']]) ?? undefined,
            terminatedAt:   parseDate(row[idx['Termination Date']]) ?? undefined,
            titleChangeDate: parseDate(row[idx['Title Change Date']]) ?? undefined,
            orientationDate: parseDate(row[idx['OrientDTE']]) ?? undefined,
            dateOfBirth:    parseDate(row[idx['Birthdate']]) ?? undefined,
            phone:          row[idx['Phone # 1']]?.trim() || null,
            phone2:         row[idx['Phone # 2']]?.trim() || null,
            gender:         row[idx['Gender']]?.trim() || null,
            maritalStatus:  row[idx['Marital Status']]?.trim() || null,
            emergencyContact:      row[idx['Contact Person']]?.trim() || null,
            emergencyPhone:        row[idx['Emergency Phone']]?.trim() || null,
            emergencyRelationship: row[idx['Relationship']]?.trim() || null,
            address1: row[idx['Address Field 1']]?.trim() || null,
            address2: row[idx['Address Field 2']]?.trim() || null,
            city:     row[idx['City']]?.trim() || null,
            state:    row[idx['State']]?.trim() || null,
            zipCode:  row[idx['Zip Code']]?.trim() || null,
            country:  row[idx['Country']]?.trim() || null,
          },
        });
      });

      // Mark email as taken so within-batch duplicates are caught
      takenEmails.add(email.toLowerCase());
      existingCodes.add(empId);
      if (wmsId) existingWmsIds.add(wmsId);

      imported++;
      console.log(`  + ${empId} ${name} (email: ${email})`);
    } catch (e) {
      failed++;
      console.error(`  FAILED: ${empId} ${name} — ${e.message.split('\n')[0]}`);
    }
  }

  console.log(`\nDone: ${imported} imported, ${failed} failed, ${skipped} skipped.`);
  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
