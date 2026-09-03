import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

// North Bergen period currently holding 5903 timesheets
const NB_PP = "cmti9dlpe000104kz0ihy33s2";

// Correct rule-set-specific periods for Aug 30 – Sep 13
const NJ_HOURLY_PP  = "cmtl4colg000004l2lshlux9z"; // NJ Hourly - No Rounding (w40)
const NJ_EXEMPT_PP  = "cmtl4conq000404l21acd4dus"; // NJ Exempt - Autopay

const NJ_HOURLY_RS  = "cmtkbrjyv00096cpk7ty24rea";
const NJ_EXEMPT_RS  = "cmtkbsx8i000b6cpku2f1g5x4";

function targetPeriod(ruleSetId: string | null): string | null {
  if (ruleSetId === NJ_HOURLY_RS) return NJ_HOURLY_PP;
  if (ruleSetId === NJ_EXEMPT_RS) return NJ_EXEMPT_PP;
  return null; // North Bergen / other — leave as-is
}

export async function GET() {
  const log: string[] = [];

  // Step 1: Move existing NB-period timesheets to the correct NJ periods
  const toMove = await db.timesheet.findMany({
    where: {
      payPeriodId: NB_PP,
      employee: { ruleSetId: { in: [NJ_HOURLY_RS, NJ_EXEMPT_RS] } },
    },
    include: {
      employee: {
        include: { ruleSet: true, user: { select: { name: true } } },
      },
    },
  });

  log.push(`Moving ${toMove.length} timesheets from North Bergen period to NJ periods...`);
  let moved = 0, moveFailed = 0;

  for (const ts of toMove) {
    const target = targetPeriod(ts.employee.ruleSetId);
    if (!target) continue;
    const name = ts.employee.user?.name ?? ts.employeeId;
    try {
      await db.timesheet.update({ where: { id: ts.id }, data: { payPeriodId: target } });
      log.push(`  ✓ moved  ${name} → ${ts.employee.ruleSet?.name}`);
      moved++;
    } catch (e) {
      log.push(`  ✗ move failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
      moveFailed++;
    }
  }

  // Step 2: Create timesheets for NJ employees who have none in the correct period
  const allNjEmps = await db.employee.findMany({
    where: {
      ruleSetId: { in: [NJ_HOURLY_RS, NJ_EXEMPT_RS] },
      site: { name: "5903" },
      isActive: true,
    },
    include: { ruleSet: true, user: { select: { name: true } } },
  });

  const existingHourly = new Set(
    (await db.timesheet.findMany({ where: { payPeriodId: NJ_HOURLY_PP }, select: { employeeId: true } }))
      .map((t) => t.employeeId)
  );
  const existingExempt = new Set(
    (await db.timesheet.findMany({ where: { payPeriodId: NJ_EXEMPT_PP }, select: { employeeId: true } }))
      .map((t) => t.employeeId)
  );

  const toCreate = allNjEmps.filter((e) => {
    const pp = targetPeriod(e.ruleSetId);
    if (pp === NJ_HOURLY_PP) return !existingHourly.has(e.id);
    if (pp === NJ_EXEMPT_PP) return !existingExempt.has(e.id);
    return false;
  });

  log.push(`\nCreating ${toCreate.length} missing timesheets in NJ periods...`);
  let created = 0, createFailed = 0;
  const allTimesheetIds: string[] = [];

  for (const emp of toCreate) {
    const pp = targetPeriod(emp.ruleSetId)!;
    const name = emp.user?.name ?? emp.id;
    try {
      const ts = await db.timesheet.create({ data: { employeeId: emp.id, payPeriodId: pp } });
      allTimesheetIds.push(ts.id);
      log.push(`  ✓ created ${name} (${emp.ruleSet?.name})`);
      created++;
    } catch (e) {
      log.push(`  ✗ create failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
      createFailed++;
    }
  }

  // Step 3: Rebuild segments for all timesheets in both NJ periods
  const allTs = await db.timesheet.findMany({
    where: {
      payPeriodId: { in: [NJ_HOURLY_PP, NJ_EXEMPT_PP] },
      employee: { site: { name: "5903" } },
    },
    include: {
      employee: {
        include: { ruleSet: true, user: { select: { name: true } } },
      },
    },
  });

  log.push(`\nRebuilding segments for ${allTs.length} timesheets...`);
  let rebuilt = 0, rebuildFailed = 0;

  for (const ts of allTs) {
    if (!ts.employee.ruleSet) continue;
    const name = ts.employee.user?.name ?? ts.employeeId;
    try {
      await rebuildSegments(ts.id, ts.employee.ruleSet);
      rebuilt++;
    } catch (e) {
      log.push(`  ✗ rebuild failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
      rebuildFailed++;
    }
  }
  log.push(`  rebuilt ${rebuilt} ok, ${rebuildFailed} failed`);

  return NextResponse.json({ moved, moveFailed, created, createFailed, rebuilt, rebuildFailed, log });
}
