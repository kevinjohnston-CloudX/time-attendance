import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { RuleSet } from "@prisma/client";

/**
 * When an employee moves from one RS-specific rule set to another (e.g., a promotion
 * that changes from punch-based to autopay), migrate the open timesheet from the old
 * RS's pay period to the matching period under the new RS.
 *
 * Only migrates when both rule sets have periods covering the same date range (same
 * frequency and anchor). If the schedules differ, the old timesheet stays in place
 * and a new one will be created on the next punch — history record still tracks the
 * effective date for split-segment logic.
 *
 * Safe to call even if no migration is needed — exits early with no side effects.
 */
export async function migrateTimesheetBetweenRuleSets(
  employeeId: string,
  oldRuleSetId: string,
  newRuleSetId: string,
  ruleSet: RuleSet,
): Promise<void> {
  const now = new Date();

  // Find the employee's current open timesheet on the old rule set's period
  const oldTimesheet = await db.timesheet.findFirst({
    where: {
      employeeId,
      payPeriod: {
        ruleSetId: oldRuleSetId,
        startDate: { lte: now },
        endDate: { gt: now },
        status: "OPEN",
      },
    },
    include: { payPeriod: { select: { startDate: true, endDate: true } } },
  });
  if (!oldTimesheet) return;

  // Find the new rule set's period covering the exact same date range
  const newPeriod = await db.payPeriod.findFirst({
    where: {
      ruleSetId: newRuleSetId,
      startDate: oldTimesheet.payPeriod.startDate,
      endDate: oldTimesheet.payPeriod.endDate,
    },
  });
  if (!newPeriod) return;

  const existing = await db.timesheet.findUnique({
    where: { employeeId_payPeriodId: { employeeId, payPeriodId: newPeriod.id } },
  });

  if (existing) {
    // Merge: move punches/exceptions from old → new, delete old
    await db.punch.updateMany({ where: { timesheetId: oldTimesheet.id }, data: { timesheetId: existing.id } });
    await db.exception.updateMany({ where: { timesheetId: oldTimesheet.id }, data: { timesheetId: existing.id } }).catch(() => {});
    await db.overtimeBucket.deleteMany({ where: { timesheetId: oldTimesheet.id } });
    await db.workSegment.deleteMany({ where: { timesheetId: oldTimesheet.id } });
    await db.timesheet.delete({ where: { id: oldTimesheet.id } });
    await rebuildSegments(existing.id, ruleSet).catch(() => {});
  } else {
    // Re-point old timesheet to new period and rebuild under new rule set
    await db.timesheet.update({
      where: { id: oldTimesheet.id },
      data: { payPeriodId: newPeriod.id },
    });
    await rebuildSegments(oldTimesheet.id, ruleSet).catch(() => {});
  }
}

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
