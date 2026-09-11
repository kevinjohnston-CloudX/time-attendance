import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";

/**
 * When an employee is assigned to a new rule set that has its own pay period schedule,
 * move any existing timesheets from overlapping tenant-level periods into the matching
 * RS-specific periods so the timecard viewer finds them correctly.
 *
 * Safe to call even if no migration is needed — exits early if the new rule set has no
 * RS-specific periods or if there are no tenant timesheets to move.
 */
export async function migrateTimesheetsOnRuleSetChange(
  employeeId: string,
  newRuleSetId: string
): Promise<void> {
  // Get the new rule set (needed for segment rebuild)
  const ruleSet = await db.ruleSet.findUnique({ where: { id: newRuleSetId } });
  if (!ruleSet) return;

  // Get all RS-specific pay periods for the new rule set
  const rsPeriods = await db.payPeriod.findMany({
    where: { ruleSetId: newRuleSetId },
    orderBy: { startDate: "asc" },
  });
  if (rsPeriods.length === 0) return;

  for (const rsPeriod of rsPeriods) {
    // Find tenant-level timesheets for this employee that overlap with this RS period
    const tenantTimesheets = await db.timesheet.findMany({
      where: {
        employeeId,
        payPeriod: {
          ruleSetId: null,
          startDate: { lte: rsPeriod.endDate },
          endDate: { gte: rsPeriod.startDate },
        },
      },
    });

    for (const tenantTs of tenantTimesheets) {
      // Check if an RS-specific timesheet already exists for this period
      const rsTs = await db.timesheet.findUnique({
        where: { employeeId_payPeriodId: { employeeId, payPeriodId: rsPeriod.id } },
      });

      if (rsTs) {
        // Both exist — merge tenant punches/exceptions into the RS timesheet, then delete tenant
        await db.punch.updateMany({
          where: { timesheetId: tenantTs.id },
          data: { timesheetId: rsTs.id },
        });
        await db.exception.updateMany({
          where: { timesheetId: tenantTs.id },
          data: { timesheetId: rsTs.id },
        }).catch(() => {});
        // Delete child records that will be rebuilt
        await db.overtimeBucket.deleteMany({ where: { timesheetId: tenantTs.id } });
        await db.workSegment.deleteMany({ where: { timesheetId: tenantTs.id } });
        await db.timesheet.delete({ where: { id: tenantTs.id } });
        // Rebuild segments for the now-merged RS timesheet
        await rebuildSegments(rsTs.id, ruleSet).catch(() => {});
      } else {
        // No RS timesheet yet — simply re-point the tenant timesheet to the RS period
        await db.timesheet.update({
          where: { id: tenantTs.id },
          data: { payPeriodId: rsPeriod.id },
        });
        // Rebuild segments under the new rule set
        await rebuildSegments(tenantTs.id, ruleSet).catch(() => {});
      }
    }
  }
}
