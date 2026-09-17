/**
 * Compare backfilled ledger ACCRUAL amounts against what the leave policies would calculate.
 *
 * For each employee with ACCRUAL entries in the ledger:
 *   1. Find their linked PtoPolicy + tier (by tenure at each posting date)
 *   2. Compute the expected deltaMinutes per posting based on policy
 *   3. Compare to actual ledger deltaMinutes
 *
 * Outputs: summary counts + any mismatches
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

// Approximate postings per year for YEARLY rateMode
const POSTINGS_PER_YEAR = {
  DAILY:          365,
  WEEKLY:          52,
  BI_WEEKLY:       26,
  SEMI_MONTHLY:    24,
  MONTHLY:         12,
  EVERY_2_MONTHS:   6,
  QUARTERLY:        4,
  EVERY_4_MONTHS:   3,
  SEMI_ANNUALLY:    2,
  ANNUALLY:         1,
  ANNUALLY_HIRE:    1,
  ANNUALLY_FIXED:   1,
  PER_PAY_PERIOD:  26, // typical bi-weekly assumption
};

function expectedMinutes(policy, rules, leaveTypeId, tenureMonths) {
  const tier = rules
    .filter(r => r.leaveTypeId === leaveTypeId && r.ptoPolicyId === policy.id)
    .find(r =>
      r.minTenureMonths <= tenureMonths &&
      (r.maxTenureMonths === null || tenureMonths < r.maxTenureMonths)
    );
  if (!tier) return null;

  const tenureYears   = Math.floor(tenureMonths / 12);
  const effectiveHrs  = tier.annualHours + tenureYears * tier.earnedHoursPerYear;
  if (effectiveHrs <= 0) return 0;

  if (policy.rateMode === 'PER_POSTING') {
    return Math.round(effectiveHrs * 60);
  } else {
    // YEARLY — divide annual hours by number of postings per year
    const freq = policy.posting1Freq;
    const divisor = POSTINGS_PER_YEAR[freq] ?? 26;
    return Math.round((effectiveHrs / divisor) * 60);
  }
}

async function main() {
  console.log('\n=== ACCRUAL POLICY MATCH CHECK ===\n');

  // Load all policies and rules
  const policies = await db.ptoPolicy.findMany({
    include: { rules: true, categoryLinks: { select: { payCategoryId: true } } },
  });
  const allRules = policies.flatMap(p => p.rules);

  // Build map: payCategoryId → [policy, ...]
  const policyByCategory = new Map();
  for (const policy of policies) {
    for (const link of policy.categoryLinks) {
      if (!policyByCategory.has(link.payCategoryId)) policyByCategory.set(link.payCategoryId, []);
      policyByCategory.get(link.payCategoryId).push(policy);
    }
  }

  // Load employees with their payCategory + hire date
  const employees = await db.employee.findMany({
    select: {
      id: true, employeeCode: true, wmsId: true,
      payCategoryId: true,
      hireDate: true, adjustedHireDate: true, orientationDate: true,
    },
  });
  const empById = new Map(employees.map(e => [e.id, e]));

  // Load all ACCRUAL ledger entries (backfilled)
  const accruals = await db.leaveAccrualLedger.findMany({
    where: { action: 'ACCRUAL' },
    select: { employeeId: true, leaveTypeId: true, deltaMinutes: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total ACCRUAL ledger entries: ${accruals.length}`);

  // Group by employee + leaveType
  const grouped = new Map(); // `${empId}|${ltId}` → entries[]
  for (const a of accruals) {
    const key = `${a.employeeId}|${a.leaveTypeId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(a);
  }

  let checked = 0, matched = 0, mismatched = 0, noPolicy = 0, noTier = 0;
  const mismatches = [];
  const noTierCases = [];
  const noPolicyCases = [];

  // Summary: policy → {match, mismatch}
  const policyStats = new Map();

  for (const [key, entries] of grouped) {
    const [empId, leaveTypeId] = key.split('|');
    const emp = empById.get(empId);
    if (!emp) continue;

    const catPolicies = emp.payCategoryId ? policyByCategory.get(emp.payCategoryId) : null;
    if (!catPolicies || catPolicies.length === 0) {
      noPolicy++;
      noPolicyCases.push({ code: emp.employeeCode, leaveTypeId });
      continue;
    }

    // Find policy that covers this leaveTypeId
    const policy = catPolicies.find(p => allRules.some(r => r.ptoPolicyId === p.id && r.leaveTypeId === leaveTypeId));
    if (!policy) {
      noPolicy++;
      noPolicyCases.push({ code: emp.employeeCode, leaveTypeId, cat: emp.payCategoryId });
      continue;
    }

    // Determine hire date basis
    const basisDate = emp.hireDate ?? new Date('2000-01-01');

    for (const entry of entries) {
      checked++;
      // Tenure at the time of this posting
      const postDate    = new Date(entry.createdAt);
      const months      = (postDate.getFullYear() - basisDate.getFullYear()) * 12
                        + (postDate.getMonth()    - basisDate.getMonth());
      const expected    = expectedMinutes(policy, allRules, leaveTypeId, months);

      const pKey = `${policy.name}|${leaveTypeId}`;
      if (!policyStats.has(pKey)) policyStats.set(pKey, { policy: policy.name, leaveTypeId, match: 0, mismatch: 0, expectedSet: new Set(), actualSet: new Set() });
      const stat = policyStats.get(pKey);

      if (expected === null) {
        noTier++;
        noTierCases.push({ code: emp.employeeCode, leaveTypeId, months });
        continue;
      }

      const actual = entry.deltaMinutes;
      stat.actualSet.add(actual);
      stat.expectedSet.add(expected);

      if (Math.abs(actual - expected) <= 1) {
        matched++;
        stat.match++;
      } else {
        mismatched++;
        stat.mismatch++;
        mismatches.push({
          code: emp.employeeCode,
          policy: policy.name,
          leaveTypeId,
          rateMode: policy.rateMode,
          freq: policy.posting1Freq,
          months,
          expected,
          actual,
          diff: actual - expected,
          date: postDate.toISOString().slice(0, 10),
        });
      }
    }
  }

  console.log(`\nRESULTS:`);
  console.log(`  Entries checked:          ${checked}`);
  console.log(`  Match (±1 min):           ${matched}`);
  console.log(`  Mismatch:                 ${mismatched}`);
  console.log(`  No policy for employee:   ${noPolicy}`);
  console.log(`  No tier for tenure:       ${noTier}`);

  // Per-policy summary
  console.log(`\nPER-POLICY SUMMARY:`);
  for (const [, stat] of policyStats) {
    const total = stat.match + stat.mismatch;
    const pct   = total > 0 ? Math.round(stat.match / total * 100) : 0;
    const expected = [...stat.expectedSet].join(', ');
    const actual   = [...stat.actualSet].sort((a, b) => a - b).join(', ');
    console.log(`  ${stat.policy.padEnd(30)} lt=${stat.leaveTypeId.slice(0, 12).padEnd(12)} match=${stat.match}/${total} (${pct}%)  expected_min=${expected}  actual_min=[${actual}]`);
  }

  // Show mismatches grouped by policy
  if (mismatches.length > 0) {
    console.log(`\nSAMPLE MISMATCHES (first 30):`);
    const shown = new Map();
    let count = 0;
    for (const m of mismatches) {
      if (count >= 30) break;
      const groupKey = `${m.policy}|${m.leaveTypeId}`;
      if ((shown.get(groupKey) ?? 0) >= 3) continue;
      shown.set(groupKey, (shown.get(groupKey) ?? 0) + 1);
      console.log(`  ${m.code.padEnd(12)} ${m.policy.padEnd(30)} ${m.rateMode.padEnd(11)} ${m.freq.padEnd(15)} tenure=${m.months}mo  expected=${m.expected}min  actual=${m.actual}min  diff=${m.diff > 0 ? '+' : ''}${m.diff}  (${m.date})`);
      count++;
    }
  }

  if (noPolicyCases.length > 0) {
    console.log(`\nEMPLOYEES WITH NO POLICY (sample 10):`);
    noPolicyCases.slice(0, 10).forEach(c =>
      console.log(`  ${c.code} lt=${c.leaveTypeId} cat=${c.cat ?? 'none'}`)
    );
  }

  await db.$disconnect();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
