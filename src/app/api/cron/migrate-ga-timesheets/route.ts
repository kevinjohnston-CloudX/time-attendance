import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

// Tenant-level period (wrong home for these employees)
const TENANT_PP = "cmsijd63h006f04jlguvt9ggz";
// Rule-set-specific period for GA Hourly - No Rounding (w40) — Aug 30–Sep 13
const RS_PP = "cmtl4conr000504l2xl53myoc";
// Rule set ID for GA Hourly - No Rounding (w40)
const GA_HOURLY_RS = "cmtkdtn710001o4pk8bhrrf5r";

const GA_WMS = [
  "600022","600023","600060","600149","600189","600282","600503","600792",
  "601147","601477","601722","601813","601908","602297","602840","603452","603608","603761",
  "603796","603860","603963","604149","604423","604726","604728","605073","605210","605247",
  "605354","605645","605821","606069","606275","606554","606585","606732","606866","606867",
  "606966","606967","607240","607262","607430","607720","607807","608091","608164","608859",
  "609043","609052","609167","609329","609596",
];

export async function GET() {
  const log: string[] = [];

  // Step 1: Move 25 existing timesheets from tenant-level → RS-specific period
  const toMove = await db.timesheet.findMany({
    where: {
      payPeriodId: TENANT_PP,
      employee: {
        ruleSetId: GA_HOURLY_RS,
        wmsId: { in: GA_WMS },
      },
    },
    include: {
      employee: {
        include: {
          ruleSet: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  log.push(`Moving ${toMove.length} existing timesheets to RS-specific period...`);

  for (const ts of toMove) {
    const name = ts.employee.user?.name ?? ts.employeeId;
    try {
      await db.timesheet.update({
        where: { id: ts.id },
        data: { payPeriodId: RS_PP },
      });
      log.push(`  ✓ moved  ${name}`);
    } catch (e) {
      log.push(`  ✗ move failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Step 2: Create timesheets for the 20 employees with no current-period timesheet
  const allGaHourly = await db.employee.findMany({
    where: {
      ruleSetId: GA_HOURLY_RS,
      wmsId: { in: GA_WMS },
    },
    include: {
      ruleSet: true,
      user: { select: { name: true } },
    },
  });

  const existingInRsPp = await db.timesheet.findMany({
    where: { payPeriodId: RS_PP },
    select: { employeeId: true },
  });
  const existingEmpIds = new Set(existingInRsPp.map((t) => t.employeeId));

  const toCreate = allGaHourly.filter((e) => !existingEmpIds.has(e.id));
  log.push(`\nCreating ${toCreate.length} new timesheets in RS-specific period...`);

  const newTimesheets: { id: string; employee: typeof allGaHourly[0] }[] = [];
  for (const emp of toCreate) {
    const name = emp.user?.name ?? emp.id;
    try {
      const ts = await db.timesheet.create({
        data: { employeeId: emp.id, payPeriodId: RS_PP },
      });
      newTimesheets.push({ id: ts.id, employee: emp });
      log.push(`  ✓ created ${name}`);
    } catch (e) {
      log.push(`  ✗ create failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Step 3: rebuildSegments for all 45 timesheets in RS-specific period
  const allInRsPp = await db.timesheet.findMany({
    where: { payPeriodId: RS_PP, employee: { wmsId: { in: GA_WMS } } },
    include: {
      employee: {
        include: {
          ruleSet: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  log.push(`\nRebuilding segments for ${allInRsPp.length} timesheets...`);
  let ok = 0, err = 0;

  for (const ts of allInRsPp) {
    const name = ts.employee.user?.name ?? ts.employeeId;
    try {
      await rebuildSegments(ts.id, ts.employee.ruleSet);
      ok++;
      log.push(`  ✓ rebuilt ${name}`);
    } catch (e) {
      err++;
      log.push(`  ✗ rebuild failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    moved: toMove.length,
    created: toCreate.length,
    rebuilt: { ok, err },
    log,
  });
}
