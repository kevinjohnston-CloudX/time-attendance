/**
 * Import employees from NovaTime XLS export.
 * Run: node scripts/import-employees-xls.cjs [--dry-run]
 *
 * Status mapping:
 *   A → isActive: true,  onLeave: false
 *   I → isActive: false, onLeave: false
 *   L → isActive: true,  onLeave: true
 *   S → isActive: true,  onLeave: true
 *
 * Skips employees already matched by employeeCode OR wmsId.
 * Badge 0 → wmsId null.
 */

const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes('--dry-run');

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
  // XLS: "Last, First" → "First Last"
  if (!raw || typeof raw !== 'string') return raw;
  const parts = raw.split(',');
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
  return raw.trim();
}

async function main() {
  console.log(DRY_RUN ? '\n=== DRY RUN — no writes ===' : '\n=== LIVE IMPORT ===');

  // ── Load XLS ──────────────────────────────────────────────────────────────
  const wb = xlsx.readFile('C:/Users/john.raefski/Downloads/Employees List HR.xls');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);

  // ── Load DB lookup maps ───────────────────────────────────────────────────
  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant found');
  console.log(`\nTenant: ${tenant.name}`);

  const [sites, depts, shifts, rulesets, holidayRules, payCategories, payTypes, existingEmps] = await Promise.all([
    db.site.findMany({ select: { id: true, name: true } }),
    db.department.findMany({ select: { id: true, name: true } }),
    db.shift.findMany({ select: { id: true, name: true } }),
    db.ruleSet.findMany({ select: { id: true, name: true } }),
    db.holidayRule.findMany({ select: { id: true, name: true } }),
    db.payCategory.findMany({ select: { id: true, number: true } }),
    db.payType.findMany({ select: { id: true, number: true } }),
    db.employee.findMany({ select: { employeeCode: true, wmsId: true } }),
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
  // Also index by numeric suffix so "108195" matches existing "D0F108195"
  const existingCodeSuffixes = new Set(
    existingEmps.map(e => e.employeeCode.replace(/^[A-Z0-9]{3}(?=\d)/, ''))
  );

  // ── Parse XLS rows ────────────────────────────────────────────────────────
  const toImport = [];
  const skipped  = [];
  const errors   = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const empId  = String(row[idx['Employee ID']]).trim();
    const status = row[idx['Employee Status']];
    const badge  = row[idx['Badge Number']];
    const badgeStr = String(badge).trim();
    const wmsId  = (badgeStr === '0' || badgeStr === '') ? null : badgeStr;

    // Skip if already in system (exact code, wmsId, or prefix-stripped suffix match e.g. D0F108195 vs 108195)
    if (
      existingCodes.has(empId) ||
      (wmsId && existingWmsIds.has(wmsId)) ||
      existingCodeSuffixes.has(empId)
    ) {
      skipped.push(empId);
      continue;
    }

    const { isActive, onLeave } = statusToFlags(status);

    // Resolve FKs
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

    // ruleSetId and siteId and deptId are required
    if (!siteId || !deptId || !ruleSetId) {
      errors.push({ empId, name: row[idx['Full Name']], reason: `Missing required FK — site:${siteId ? '✓' : siteName} dept:${deptId ? '✓' : deptName} ruleset:${ruleSetId ? '✓' : rulesetName}` });
      continue;
    }

    const rawName = row[idx['Full Name']];
    const name    = formatName(rawName);
    const email   = row[idx['Email Address']]?.trim() || null;
    const chargeRate = row[idx['Charge Rate']];
    const payRate = (chargeRate && chargeRate !== 0) ? chargeRate : null;

    toImport.push({
      empId, name, email, wmsId, isActive, onLeave,
      siteId, deptId, shiftId, ruleSetId, holidayRuleId, payCategoryId, payTypeId,
      payRate,
      payType: toPayType(row[idx['Pay Method']]),
      jobTitle:        row[idx['Job Title']]?.trim() || null,
      hireDate:        parseDate(row[idx['Hire Date']]),
      adjustedHireDate: parseDate(row[idx['Adjusted Hire Date']]),
      terminatedAt:    parseDate(row[idx['Termination Date']]),
      titleChangeDate: parseDate(row[idx['Title Change Date']]),
      orientationDate: parseDate(row[idx['OrientDTE']]),
      dateOfBirth:     parseDate(row[idx['Birthdate']]),
      phone:           row[idx['Phone # 1']]?.trim() || null,
      phone2:          row[idx['Phone # 2']]?.trim() || null,
      gender:          row[idx['Gender']]?.trim() || null,
      maritalStatus:   row[idx['Marital Status']]?.trim() || null,
      emergencyContact:      row[idx['Contact Person']]?.trim() || null,
      emergencyPhone:        row[idx['Emergency Phone']]?.trim() || null,
      emergencyRelationship: row[idx['Relationship']]?.trim() || null,
      address1: row[idx['Address Field 1']]?.trim() || null,
      address2: row[idx['Address Field 2']]?.trim() || null,
      city:     row[idx['City']]?.trim() || null,
      state:    row[idx['State']]?.trim() || null,
      zipCode:  row[idx['Zip Code']]?.trim() || null,
      country:  row[idx['Country']]?.trim() || null,
    });
  }

  console.log(`\nRows to import: ${toImport.length}`);
  console.log(`Skipped (already in system): ${skipped.length}`);
  console.log(`Errors (missing required FK): ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  ${e.empId} ${e.name} — ${e.reason}`));
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. Re-run without --dry-run to import.');
    await db.$disconnect();
    await pool.end();
    return;
  }

  // ── Import ────────────────────────────────────────────────────────────────
  let imported = 0;
  let failed = 0;

  for (const emp of toImport) {
    try {
      await db.$transaction(async (tx) => {
        // Generate a unique placeholder email if blank
        const email = emp.email || `emp-${emp.empId}@noreply.local`;

        const user = await tx.user.create({
          data: {
            name: emp.name,
            email,
          },
        });

        await tx.employee.create({
          data: {
            tenantId:     tenant.id,
            userId:       user.id,
            employeeCode: emp.empId,
            wmsId:        emp.wmsId,
            isActive:     emp.isActive,
            onLeave:      emp.onLeave,
            siteId:       emp.siteId,
            departmentId: emp.deptId,
            ruleSetId:    emp.ruleSetId,
            shiftId:      emp.shiftId ?? undefined,
            holidayRuleId:  emp.holidayRuleId ?? undefined,
            payCategoryId:  emp.payCategoryId ?? undefined,
            payTypeId:      emp.payTypeId ?? undefined,
            payType:        emp.payType,
            payRate:        emp.payRate,
            jobTitle:       emp.jobTitle,
            hireDate:       emp.hireDate ?? new Date('1970-01-01'),
            adjustedHireDate: emp.adjustedHireDate ?? undefined,
            terminatedAt:   emp.terminatedAt ?? undefined,
            titleChangeDate: emp.titleChangeDate ?? undefined,
            orientationDate: emp.orientationDate ?? undefined,
            dateOfBirth:    emp.dateOfBirth ?? undefined,
            phone:          emp.phone,
            phone2:         emp.phone2,
            gender:         emp.gender,
            maritalStatus:  emp.maritalStatus,
            emergencyContact:      emp.emergencyContact,
            emergencyPhone:        emp.emergencyPhone,
            emergencyRelationship: emp.emergencyRelationship,
            address1: emp.address1,
            address2: emp.address2,
            city:     emp.city,
            state:    emp.state,
            zipCode:  emp.zipCode,
            country:  emp.country,
          },
        });
      });

      imported++;
      if (imported % 50 === 0) console.log(`  Imported ${imported}/${toImport.length}...`);
    } catch (e) {
      failed++;
      console.error(`  FAILED: ${emp.empId} ${emp.name} — ${e.message}`);
    }
  }

  console.log(`\nDone: ${imported} imported, ${failed} failed, ${skipped.length} skipped.`);
  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
