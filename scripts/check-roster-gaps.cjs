/**
 * Check roster-gap-badges CSV against Cloud Time.
 * The oracle_empid column = wmsId in Cloud Time.
 * Also checks the barcode column as a fallback (tablet scans).
 */
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const CSV = 'C:/Users/john.raefski/Downloads/roster-gap-badges (1).csv';

async function main() {
  const lines = fs.readFileSync(CSV, 'utf8').trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim());
  const col = n => header.indexOf(n);

  const rows = lines.slice(1).map(l => {
    const parts = l.split(',');
    return {
      badge:       parts[col('badge')]?.trim(),
      oracleId:    parts[col('oracle_empid')]?.trim(),
      scans:       parts[col('scans')]?.trim(),
      firstScan:   parts[col('first_scan_utc')]?.trim(),
      lastScan:    parts[col('last_scan_utc')]?.trim(),
    };
  }).filter(r => r.oracleId);

  console.log(`Roster rows: ${rows.length}`);

  const oracleIds = rows.map(r => r.oracleId);
  const badges    = rows.map(r => r.badge);

  // Look up by wmsId (oracle_empid)
  const byWms = await db.employee.findMany({
    where: { wmsId: { in: oracleIds } },
    select: { wmsId: true, employeeCode: true, isActive: true, user: { select: { name: true } }, site: { select: { name: true } } },
  });
  const foundByWms = new Map(byWms.map(e => [e.wmsId, e]));

  // Look up by barcode (badge column) for any still missing
  const stillMissingBadges = rows.filter(r => !foundByWms.has(r.oracleId)).map(r => r.badge);
  const byBarcode = stillMissingBadges.length ? await db.employee.findMany({
    where: { barcode: { in: stillMissingBadges } },
    select: { barcode: true, wmsId: true, employeeCode: true, isActive: true, user: { select: { name: true } }, site: { select: { name: true } } },
  }) : [];
  const foundByBarcode = new Map(byBarcode.map(e => [e.barcode, e]));

  const found    = [];
  const missing  = [];

  for (const row of rows) {
    const emp = foundByWms.get(row.oracleId) ?? foundByBarcode.get(row.badge);
    if (emp) {
      found.push({ row, emp, how: foundByWms.has(row.oracleId) ? 'wmsId' : 'barcode' });
    } else {
      missing.push(row);
    }
  }

  console.log(`\nFound in Cloud Time: ${found.length}`);
  console.log(`NOT found:           ${missing.length}`);

  if (missing.length) {
    console.log('\n=== NOT IN CLOUD TIME ===');
    console.log('OracleId'.padEnd(12), 'Badge'.padEnd(14), 'Scans', 'First Scan');
    missing.forEach(r =>
      console.log(r.oracleId.padEnd(12), r.badge.padEnd(14), r.scans.padEnd(6), r.firstScan)
    );
  }

  // Show found but inactive
  const inactive = found.filter(f => !f.emp.isActive);
  if (inactive.length) {
    console.log('\n=== FOUND BUT INACTIVE ===');
    inactive.forEach(f =>
      console.log(f.row.oracleId.padEnd(12), `"${f.emp.user.name}"`, `[${f.emp.site?.name ?? '?'}]`)
    );
  }

  // Show found with no wmsId (matched via barcode only)
  const barcodeOnly = found.filter(f => f.how === 'barcode');
  if (barcodeOnly.length) {
    console.log('\n=== MATCHED BY BARCODE (wmsId still null) ===');
    barcodeOnly.forEach(f =>
      console.log(f.row.oracleId.padEnd(12), f.row.badge.padEnd(14), `"${f.emp.user.name}"`,'wmsId:', f.emp.wmsId ?? 'null')
    );
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total in roster:     ${rows.length}`);
  console.log(`Found by wmsId:      ${found.filter(f => f.how === 'wmsId').length}`);
  console.log(`Found by barcode:    ${barcodeOnly.length}`);
  console.log(`Not found at all:    ${missing.length}`);
  const inactive2 = found.filter(f => !f.emp.isActive).length;
  if (inactive2) console.log(`Found but inactive:  ${inactive2}`);
}

main().finally(() => { db.$disconnect(); pool.end(); });
