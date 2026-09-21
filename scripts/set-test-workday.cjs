/**
 * Marks one employee's day as a workday so the gate's eligibility check lets
 * them scan in and out for testing.
 *
 * Written as a CLOUDTIME / LOCAL_EDIT row on purpose. Oracle says this is not
 * a workday, and `schedule.pull` runs every 15 minutes — a plain isWorkday
 * flip would be reverted mid-test, which is exactly the kind of thing that
 * looks like an app bug. LOCAL_EDIT is the flag the sync service checks before
 * overwriting, so this survives the pull and shows up as a known divergence
 * rather than a silent one.
 *
 * Usage: node scripts/set-test-workday.cjs <badge> <YYYY-MM-DD> [--off]
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const badge = process.argv[2];
const dateArg = process.argv[3];
const turnOff = process.argv.includes('--off');

async function main() {
  if (!badge || !dateArg) {
    throw new Error('Usage: node scripts/set-test-workday.cjs <badge> <YYYY-MM-DD> [--off]');
  }

  // Same match the kiosk uses — 6-digit wmsId or 10-digit barcode.
  const employee = await db.employee.findFirst({
    where: { OR: [{ wmsId: badge.trim() }, { barcode: badge.trim() }] },
    select: {
      id: true,
      tenantId: true,
      wmsId: true,
      user: { select: { name: true } },
      shift: { select: { startTime: true, endTime: true } },
    },
  });
  if (!employee) throw new Error(`No employee for badge ${badge}`);

  const workDate = new Date(`${dateArg}T00:00:00.000Z`);

  const before = await db.scheduleDay.findFirst({
    where: { employeeId: employee.id, workDate },
    select: { isWorkday: true, startTime: true, endTime: true, source: true, syncState: true },
  });

  console.log(`Employee : ${employee.user?.name} (${employee.wmsId})`);
  console.log(`Date     : ${dateArg}`);
  console.log(`Before   : ${before ? JSON.stringify(before) : '(no row)'}`);

  const scheduling = {
    isWorkday: !turnOff,
    // Keep whatever the row already had; fall back to the assigned shift so a
    // created row still reports a shift to the kiosk.
    startTime: before?.startTime ?? employee.shift?.startTime ?? '09:30',
    endTime: before?.endTime ?? employee.shift?.endTime ?? '18:30',
  };

  const after = await db.scheduleDay.upsert({
    where: { employeeId_workDate: { employeeId: employee.id, workDate } },
    update: { ...scheduling, source: 'CLOUDTIME', syncState: 'LOCAL_EDIT' },
    create: {
      tenantId: employee.tenantId,
      employeeId: employee.id,
      workDate,
      ...scheduling,
      mealMinutes: null,
      source: 'CLOUDTIME',
      syncState: 'LOCAL_EDIT',
    },
    select: { isWorkday: true, startTime: true, endTime: true, source: true, syncState: true },
  });

  console.log(`After    : ${JSON.stringify(after)}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    await pool.end();
  });
