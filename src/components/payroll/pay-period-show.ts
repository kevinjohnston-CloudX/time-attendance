/**
 * The pay period's "Show" filter on its timesheet table: where in the approval
 * chain a timesheet sits, or whether it has exceptions. Its own module because
 * the page filters on the server and the pill lists the choices in the browser.
 * The close checklist links to these, so each step's "Show" lands on exactly
 * the timesheets that step is waiting on.
 */

export const SHOW_OPTIONS = [
  { id: "employee", name: "Not submitted" },
  { id: "supervisor", name: "Waiting on supervisor" },
  { id: "payroll", name: "Waiting on payroll" },
  { id: "approved", name: "Approved" },
  { id: "exceptions", name: "Has exceptions" },
] as const;

export type TimesheetShow = (typeof SHOW_OPTIONS)[number]["id"];

export function parseShow(value: string | undefined): TimesheetShow | "" {
  return SHOW_OPTIONS.some((o) => o.id === value) ? (value as TimesheetShow) : "";
}

export function matchesShow(show: TimesheetShow, status: string, exceptions: number): boolean {
  switch (show) {
    case "employee":
      return status === "OPEN" || status === "REJECTED";
    case "supervisor":
      return status === "SUBMITTED";
    case "payroll":
      return status === "SUP_APPROVED";
    case "approved":
      return status === "PAYROLL_APPROVED" || status === "LOCKED";
    case "exceptions":
      return exceptions > 0;
  }
}
