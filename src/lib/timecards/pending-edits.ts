import { db } from "@/lib/db";

/**
 * Throws while supervisor changes on these timecards wait for HR: a period or
 * timecard locked over them would leave them never applied. `except` are
 * timecards left open by the lock (Run Payroll's keepOpen).
 */
export async function assertNoPendingEdits(where: { payPeriodId?: string; timesheetIds?: string[]; except?: string[] }): Promise<void> {
  const pending = await db.timecardEditRequest.findMany({
    where: {
      status: "PENDING",
      items: { some: { status: "PENDING" } },
      timesheet: {
        ...(where.payPeriodId ? { payPeriodId: where.payPeriodId } : {}),
        ...(where.timesheetIds ? { id: { in: where.timesheetIds } } : {}),
        ...(where.except?.length ? { NOT: { id: { in: where.except } } } : {}),
      },
    },
    select: { timesheet: { select: { employee: { select: { user: { select: { name: true } }, employeeCode: true } } } } },
  });
  if (pending.length === 0) return;
  const names = [...new Set(pending.map((r) => r.timesheet.employee.user?.name ?? r.timesheet.employee.employeeCode))];
  const who = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  throw new Error(
    `${pending.length === 1 ? "A supervisor's change waits" : `${pending.length} supervisors' changes wait`} for HR approval (${who}). Approve or reject ${pending.length === 1 ? "it" : "them"} first, then lock.`,
  );
}
