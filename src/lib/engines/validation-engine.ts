import { db } from "@/lib/db";
import { TimesheetStatus } from "@prisma/client";

export interface TimesheetIssue {
  timesheetId: string;
  employeeName: string;
  issue: string;
}

export interface ValidationResult {
  isReady: boolean;
  totalTimesheets: number;
  approvedCount: number;
  pendingCount: number;
  unresolvedExceptions: number;
  issues: TimesheetIssue[];
}

const APPROVED_STATUSES = new Set<TimesheetStatus>([
  TimesheetStatus.PAYROLL_APPROVED,
  TimesheetStatus.LOCKED,
]);

/**
 * Check whether all timesheets in a pay period are ready for locking.
 * Returns a structured ValidationResult so the UI can show per-employee issues.
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
  let approvedCount = 0;
  let pendingCount = 0;
  let unresolvedExceptions = 0;

  for (const ts of timesheets) {
    const name = ts.employee.user?.name ?? `Employee ${ts.employeeId}`;

    if (!APPROVED_STATUSES.has(ts.status)) {
      issues.push({
        timesheetId: ts.id,
        employeeName: name,
        issue: `Timesheet is ${ts.status} — not yet payroll-approved`,
      });
      pendingCount++;
    } else {
      approvedCount++;
    }

    if (ts.exceptions.length > 0) {
      unresolvedExceptions += ts.exceptions.length;
      issues.push({
        timesheetId: ts.id,
        employeeName: name,
        issue: `${ts.exceptions.length} unresolved exception(s)`,
      });
    }
  }

  return {
    isReady: issues.length === 0,
    totalTimesheets: timesheets.length,
    approvedCount,
    pendingCount,
    unresolvedExceptions,
    issues,
  };
}
