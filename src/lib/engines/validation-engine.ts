import { db } from "@/lib/db";

export interface TimesheetIssue {
  timesheetId: string;
  employeeName: string;
  issue: string;
}

export interface ValidationResult {
  totalTimesheets: number;
  unresolvedExceptions: number;
  issues: TimesheetIssue[];
}

/**
 * What is still open on a pay period's timecards. There are no approval steps,
 * so the only thing to report is unresolved exceptions; they are shown before
 * locking, not required to be cleared.
 */
export async function validatePayPeriod(
  payPeriodId: string
): Promise<ValidationResult> {
  const timesheets = await db.timesheet.findMany({
    where: { payPeriodId },
    include: {
      employee: { include: { user: true } },
      exceptions: { where: { resolvedAt: null } },
    },
  });

  const issues: TimesheetIssue[] = [];
  let unresolvedExceptions = 0;

  for (const ts of timesheets) {
    if (ts.exceptions.length === 0) continue;
    unresolvedExceptions += ts.exceptions.length;
    issues.push({
      timesheetId: ts.id,
      employeeName: ts.employee.user?.name ?? `Employee ${ts.employeeId}`,
      issue: `${ts.exceptions.length} unresolved exception(s)`,
    });
  }

  return {
    totalTimesheets: timesheets.length,
    unresolvedExceptions,
    issues,
  };
}
