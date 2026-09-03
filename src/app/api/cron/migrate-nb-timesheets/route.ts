import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

const NB_RS   = "cmm2u8tx90003owugu7mxcf28"; // North Bergen rule set
const RS_PP   = "cmti9dlpe000104kz0ihy33s2"; // NB RS-specific period (Aug 30–Sep 13)
const TENT_PP = "cmsijd63h006f04jlguvt9ggz"; // Tenant-level period (Aug 30–Sep 12)

export async function GET() {
  const log: string[] = [];

  // Find all NB employees who have a timesheet in BOTH periods
  const employees = await db.employee.findMany({
    where: { ruleSetId: NB_RS },
    select: {
      id: true,
      user: { select: { name: true } },
      timesheets: {
        where: { payPeriodId: { in: [RS_PP, TENT_PP] } },
        select: { id: true, payPeriodId: true },
      },
    },
  });

  let merged = 0, skipped = 0, err = 0;

  for (const emp of employees) {
    const name = emp.user?.name ?? emp.id;
    const rsTs   = emp.timesheets.find((t) => t.payPeriodId === RS_PP);
    const tentTs = emp.timesheets.find((t) => t.payPeriodId === TENT_PP);

    if (!tentTs) {
      // Already correct — only RS-specific timesheet
      skipped++;
      continue;
    }

    if (!rsTs) {
      // Tenant-level only — just move payPeriodId (shouldn't happen per scope check, but handle it)
      try {
        await db.timesheet.update({
          where: { id: tentTs.id },
          data: { payPeriodId: RS_PP },
        });
        log.push(`  ✓ moved (solo) ${name}`);
        merged++;
      } catch (e) {
        log.push(`  ✗ move failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
        err++;
      }
      continue;
    }

    // Both exist — migrate punches from tenant-level → RS-specific, then delete stale timesheet
    try {
      await db.$transaction(async (tx) => {
        // Relink all punches from stale tenant-level timesheet to RS-specific
        await tx.punch.updateMany({
          where: { timesheetId: tentTs.id },
          data: { timesheetId: rsTs.id },
        });

        // Clear stale derived data (will be rebuilt by rebuildSegments)
        await tx.workSegment.deleteMany({ where: { timesheetId: tentTs.id } });
        await tx.exception.deleteMany({ where: { timesheetId: tentTs.id } });
        await tx.overtimeBucket.deleteMany({ where: { timesheetId: tentTs.id } });

        // Delete the stale tenant-level timesheet
        await tx.timesheet.delete({ where: { id: tentTs.id } });
      });
      log.push(`  ✓ merged  ${name}`);
      merged++;
    } catch (e) {
      log.push(`  ✗ merge failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
      err++;
    }
  }

  log.unshift(`Merged/moved: ${merged}, skipped (already correct): ${skipped}, errors: ${err}\n`);

  // Rebuild segments for all NB employees in the RS-specific period
  const timesheets = await db.timesheet.findMany({
    where: {
      payPeriodId: RS_PP,
      employee: { ruleSetId: NB_RS },
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

  log.push(`\nRebuilding segments for ${timesheets.length} NB timesheets...`);
  let ok = 0, rebuildErr = 0;

  for (const ts of timesheets) {
    const name = ts.employee.user?.name ?? ts.employeeId;
    try {
      await rebuildSegments(ts.id, ts.employee.ruleSet);
      ok++;
    } catch (e) {
      rebuildErr++;
      log.push(`  ✗ rebuild failed ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log.push(`Rebuild: ${ok} ok, ${rebuildErr} errors`);

  return NextResponse.json({ merged, skipped, err, rebuilt: { ok, err: rebuildErr }, log });
}
