import { db } from "@/lib/db";
import { rebuildSegments } from "@/lib/engines/segment-builder";
import { syncLeaveSegments } from "@/lib/engines/leave-segment-builder";

/**
 * Works out the hours again on the timecards leave just went on or came off
 * (11/12).
 *
 * <p>Putting leave on a timecard only adds its own lines; the rest of the day
 * was left as it was. A salaried person's day keeps 8 h of salary less the
 * leave on it, worked out when the hours are, so an approved 9 h PTO day
 * showed 8 h Salary and 9 h PTO, 17 h, until somebody pressed Recalculate
 * hours (Flavio Morales, 11/13). Auto-pay days and the overtime totals had the
 * same lag. A locked or payroll approved timecard is left as it is: its hours
 * are what was paid.
 */
export async function recalculateAfterLeave(timesheetIds: Iterable<string>): Promise<void> {
  for (const id of new Set(timesheetIds)) {
    try {
      const sheet = await db.timesheet.findUnique({
        where: { id },
        select: { id: true, status: true, employee: { select: { ruleSet: true } } },
      });
      if (!sheet || sheet.status === "LOCKED" || sheet.status === "PAYROLL_APPROVED") continue;
      await rebuildSegments(sheet.id, sheet.employee.ruleSet);
    } catch (err) {
      // The leave is in either way; Recalculate hours puts the day right.
      console.error("leave: hours not worked out again on", id, err);
    }
  }
}

/** Puts a request's leave on its timecards (or takes it off), then works their hours out again. */
export async function placeLeave(leaveRequestId: string): Promise<void> {
  await recalculateAfterLeave(await syncLeaveSegments(leaveRequestId));
}
