import type { DataSourceId, FilterDef, SortDef } from "@/lib/validators/report.schema";

/**
 * The ready-made reports: NovaTime's report templates that CloudTime's report
 * types can already produce, under the names and folders HR knows them by.
 *
 * <p>Each one is only a starting point for the builder: a report type with
 * its columns, filters, groups, sort and dates set the way NovaTime's
 * template sets them. Nothing is saved until somebody saves it, and anything
 * can be changed first. Plain data, so the New report window can list them
 * without reaching for the database.
 *
 * <p>The NovaTime settings each one follows are in novatime-reports/02-settings.md
 * beside the repo.
 */

/** When a ready-made report opens on, worked out when it is opened. */
export type StandardDates =
  | "currentPayPeriod"
  | "previousPayPeriod"
  | "yesterday";

export interface StandardReport {
  /** Stable, in the address: /reports/new?standard=summary. */
  id: string;
  /** NovaTime's folder. */
  folder: StandardFolder;
  /** NovaTime's name, without the folder suffix (".TA", ".PR", ".ACC"). */
  name: string;
  /** What it is saved as by default, where the name alone repeats another folder's. */
  saveName?: string;
  /** NovaTime's own name for it, so HR can find the one they used. */
  novaTimeName: string;
  /** One plain line on what it answers. */
  description: string;
  source: DataSourceId;
  columns: string[];
  filters?: FilterDef[];
  groupBy?: string[];
  sortBy?: SortDef[];
  dates: StandardDates;
}

export const STANDARD_FOLDERS = ["Time and attendance", "Human resources", "Accruals", "Payroll"] as const;
export type StandardFolder = (typeof STANDARD_FOLDERS)[number];

/** The Detail report's columns, the same in both folders. */
const DETAIL_COLUMNS = [
  "employeeName", "employeeCode", "date", "segmentType", "startTime", "endTime",
  "payCodeLabel", "reasonCode", "regularMinutes", "overtimeMinutes", "doubletimeMinutes", "durationMinutes",
];
const EXCEPTION_COLUMNS = ["employeeName", "employeeCode", "exceptionType", "description", "occurredAt", "resolved"];
const BY_SITE_AND_DEPARTMENT = ["site", "department"];
const BY_NAME_THEN_DAY: SortDef[] = [
  { field: "employeeName", direction: "asc" },
  { field: "date", direction: "asc" },
];

export const STANDARD_REPORTS: StandardReport[] = [
  // ── Time and attendance ────────────────────────────────────────────────
  {
    id: "summary",
    folder: "Time and attendance",
    name: "Summary report",
    novaTimeName: "Summary Report.TA",
    description: "Each employee's regular, overtime, holiday and sick hours for the pay period, with totals by site and department.",
    source: "HOURS_SUMMARY",
    columns: ["employeeName", "employeeCode", "regMinutes", "otMinutes", "dtMinutes", "holidayMinutes", "sickMinutes", "totalMinutes"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    dates: "currentPayPeriod",
  },
  {
    id: "detail",
    folder: "Time and attendance",
    name: "Detail report",
    novaTimeName: "Detail Report.TA",
    description: "Every clock in and clock out, meal and time off line in the pay period, with its pay code and hours, by site and department.",
    source: "ATTENDANCE_DETAIL",
    columns: DETAIL_COLUMNS,
    groupBy: BY_SITE_AND_DEPARTMENT,
    sortBy: BY_NAME_THEN_DAY,
    dates: "currentPayPeriod",
  },
  {
    id: "exceptions",
    folder: "Time and attendance",
    name: "Exception report",
    novaTimeName: "Exception Report",
    description: "Yesterday's missed punches, absences and other rule breaks, by department, and whether each was fixed.",
    source: "EXCEPTION_REPORT",
    columns: EXCEPTION_COLUMNS,
    groupBy: ["department"],
    dates: "yesterday",
  },
  {
    id: "approval-status",
    folder: "Time and attendance",
    name: "Timesheet approval status",
    novaTimeName: "Timesheet Approval Status",
    description: "Which timesheets are still open and which are locked this pay period, by department, with each person's hours.",
    source: "HOURS_SUMMARY",
    columns: ["employeeName", "employeeCode", "regMinutes", "otMinutes", "dtMinutes", "totalMinutes", "status"],
    groupBy: ["department", "status"],
    dates: "currentPayPeriod",
  },
  {
    id: "days-worked",
    folder: "Time and attendance",
    name: "Days worked report",
    novaTimeName: "Days Worked Report",
    description: "How many days each employee worked in the pay period, and their hours, by site and department.",
    source: "EMPLOYEES",
    columns: ["employeeName", "employeeCode", "daysWorkedInRange", "hoursInRange"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    dates: "currentPayPeriod",
  },

  // ── Human resources ────────────────────────────────────────────────────
  {
    id: "employee-listing",
    folder: "Human resources",
    name: "Employee listing",
    novaTimeName: "Employee Listing",
    description: "Every current employee with their badge, pay category, pay type, status and hire date, by site and department.",
    source: "EMPLOYEES",
    columns: ["employeeName", "employeeCode", "payCategory", "payType", "hireDate", "status"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    dates: "currentPayPeriod",
  },
  {
    id: "inactive",
    folder: "Human resources",
    name: "Inactive employee listing",
    novaTimeName: "Inactive Employee Listing",
    description: "Current employees with no punch in 14 days or more, longest first. Change the number of days in Filters.",
    source: "EMPLOYEES",
    columns: ["employeeName", "employeeCode", "site", "department", "lastPunch", "daysSinceLastPunch"],
    filters: [{ field: "daysSinceLastPunch", operator: "gte", value: 14 }],
    sortBy: [{ field: "daysSinceLastPunch", direction: "desc" }],
    dates: "currentPayPeriod",
  },
  {
    id: "new-hires",
    folder: "Human resources",
    name: "New hire report",
    novaTimeName: "New Hire Report",
    description: "Everyone hired in the pay period, newest first, with their site, department, job title and supervisor.",
    source: "EMPLOYEES",
    columns: ["employeeName", "employeeCode", "site", "department", "jobTitle", "supervisor", "hireDate"],
    filters: [{ field: "hireDate", operator: "inRange", value: "" }],
    sortBy: [{ field: "hireDate", direction: "desc" }],
    dates: "currentPayPeriod",
  },
  {
    id: "supervisor-list",
    folder: "Human resources",
    name: "Supervisor employee list",
    novaTimeName: "Supervisor Employee List",
    description: "Each supervisor and the employees who report to them.",
    source: "EMPLOYEES",
    columns: ["employeeName", "employeeCode", "site", "department", "jobTitle"],
    groupBy: ["supervisor"],
    dates: "currentPayPeriod",
  },
  {
    id: "job-rates",
    folder: "Human resources",
    name: "Employee job rate report",
    novaTimeName: "Employee Job Rate Report",
    description: "Each employee's pay rate, markup and charge rate, by agency.",
    source: "EMPLOYEES",
    columns: ["employeeName", "employeeCode", "jobTitle", "payRate", "markupPct", "chargeRate"],
    groupBy: ["agency"],
    dates: "currentPayPeriod",
  },

  // ── Accruals ───────────────────────────────────────────────────────────
  {
    id: "balances",
    folder: "Accruals",
    name: "Balance report",
    novaTimeName: "Balance Report.ACC",
    description: "Each employee's time off earned, used and left, by type, by department.",
    source: "LEAVE_BALANCE",
    columns: ["employeeName", "employeeCode", "leaveType", "accrualYear", "balanceMinutes", "usedMinutes", "remainingMinutes"],
    groupBy: ["department"],
    dates: "currentPayPeriod",
  },
  {
    id: "time-off-requests",
    folder: "Accruals",
    name: "Request time off report",
    novaTimeName: "Request Time-Off Report",
    description: "Time off requested for days in the pay period, with its type, hours, status and when it was asked for and answered.",
    source: "LEAVE_SUMMARY",
    columns: ["employeeName", "employeeCode", "leaveType", "startDate", "endDate", "durationMinutes", "status", "submittedAt", "reviewedAt"],
    sortBy: [{ field: "startDate", direction: "asc" }],
    dates: "currentPayPeriod",
  },

  // ── Payroll: the pay period just closed ────────────────────────────────
  {
    id: "payroll-summary",
    folder: "Payroll",
    name: "Summary report",
    saveName: "Payroll summary report",
    novaTimeName: "Summary Report.PR",
    description: "The last pay period's hours and pay for each employee, by site and department.",
    source: "LABOR_COST",
    columns: ["employeeName", "employeeCode", "regMinutes", "otMinutes", "dtMinutes", "leaveMinutes", "premiumMinutes", "payRate", "payCost"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    dates: "previousPayPeriod",
  },
  {
    id: "payroll-detail",
    folder: "Payroll",
    name: "Detail report",
    saveName: "Payroll detail report",
    novaTimeName: "Detail Report.PR",
    description: "Every line of the last pay period, with its pay code and hours, by site and department.",
    source: "ATTENDANCE_DETAIL",
    columns: DETAIL_COLUMNS,
    groupBy: BY_SITE_AND_DEPARTMENT,
    sortBy: BY_NAME_THEN_DAY,
    dates: "previousPayPeriod",
  },
  {
    id: "payroll-exceptions",
    folder: "Payroll",
    name: "Exception report",
    saveName: "Payroll exception report",
    novaTimeName: "Exception Report.PR",
    description: "The last pay period's missed punches, absences and other rule breaks, by department, and whether each was fixed.",
    source: "EXCEPTION_REPORT",
    columns: EXCEPTION_COLUMNS,
    groupBy: ["department"],
    dates: "previousPayPeriod",
  },
];

export function standardReport(id: string | null | undefined): StandardReport | undefined {
  return id ? STANDARD_REPORTS.find((r) => r.id === id) : undefined;
}
