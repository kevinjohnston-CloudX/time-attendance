import type { DataSourceId, FilterDef, SortDef } from "@/lib/validators/report.schema";
import type { PrintLayout } from "./grouping";
import type { AcrossSpec } from "./across";

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
  | "currentWeek"
  | "currentMonth"
  | "previousMonth"
  | "currentYear"
  | "last7Days"
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
  /** A page per group and signature lines, for the reports people sign. */
  layout?: PrintLayout;
  /** One field spread across the columns: days, dates or pay codes. */
  across?: AcrossSpec;
  dates: StandardDates;
}

export const STANDARD_FOLDERS = ["Time and attendance", "Human resources", "Accruals", "Payroll"] as const;
export type StandardFolder = (typeof STANDARD_FOLDERS)[number];

/** The Detail report's columns, the same in both folders. */
const DETAIL_COLUMNS = [
  "employeeName", "employeeCode", "date", "segmentType", "startTime", "endTime",
  "payCodeLabel", "reasonCode", "regularMinutes", "overtimeMinutes", "doubletimeMinutes", "paidMinutes",
];
/** NovaTime's Exception report defaults: absences, missed punches, late and early. */
const ATTENDANCE_EXCEPTIONS: FilterDef = { field: "exceptionType", operator: "in", value: ["ABSENT", "MISSING_PUNCH", "LATE_IN", "EARLY_OUT"] };
const EXCEPTION_COLUMNS = ["employeeName", "employeeCode", "exceptionType", "description", "occurredAt", "resolved"];
const BY_SITE_AND_DEPARTMENT = ["site", "department"];
const BY_NAME_THEN_DAY: SortDef[] = [
  { field: "employeeName", direction: "asc" },
  { field: "date", direction: "asc" },
];
/** NovaTime's statement on its timesheets. */
const CERTIFY = "I certify the above information to be correct.";
/** A timesheet: each day with its clock times and hours. */
const TIMESHEET_COLUMNS = [
  "date", "punchPairs", "regMinutes", "otMinutes", "dtMinutes", "timeOffMinutes", "holidayMinutes", "totalMinutes", "payCodes",
];
const BY_DAY: SortDef[] = [{ field: "date", direction: "asc" }];

export const STANDARD_REPORTS: StandardReport[] = [
  // ── Time and attendance ────────────────────────────────────────────────
  {
    id: "summary",
    folder: "Time and attendance",
    name: "Summary report",
    novaTimeName: "Summary Report.TA",
    description: "Each employee's regular, overtime and double time worked, holiday, PTO and sick hours, and their worked and paid totals for the pay period, by site and department.",
    source: "HOURS_SUMMARY",
    columns: [
      "employeeName", "employeeCode", "regMinutes", "otMinutes", "dtMinutes", "totalMinutes",
      "holidayMinutes", "vacationMinutes", "sickMinutes", "paidTotalMinutes",
    ],
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
    description: "Yesterday's absences, missed punches and late or early days, by department, and whether each was fixed.",
    source: "EXCEPTION_REPORT",
    columns: EXCEPTION_COLUMNS,
    filters: [ATTENDANCE_EXCEPTIONS],
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
    id: "weekly-timesheet",
    folder: "Time and attendance",
    name: "Weekly timesheet",
    novaTimeName: "Weekly TimeSheet",
    description: "A page for each employee with this week's clock in and clock out times and hours by day, and a line for them to sign.",
    source: "DAILY_HOURS",
    columns: TIMESHEET_COLUMNS,
    groupBy: ["employeeName"],
    sortBy: BY_DAY,
    layout: { pageBreak: "employeeName", signature: { text: CERTIFY, employee: true, supervisor: false } },
    dates: "currentWeek",
  },
  {
    id: "biweekly-timesheet",
    folder: "Time and attendance",
    name: "Bi-weekly timesheet",
    novaTimeName: "Bi-Weekly TimeSheet",
    description: "A page for each employee with the pay period's days, a total for each week and the two weeks, and lines for the employee and supervisor to sign.",
    source: "DAILY_HOURS",
    columns: TIMESHEET_COLUMNS,
    groupBy: ["employeeName", "week"],
    sortBy: BY_DAY,
    layout: { pageBreak: "employeeName", signature: { text: CERTIFY, employee: true, supervisor: true } },
    dates: "currentPayPeriod",
  },
  {
    id: "timecard",
    folder: "Time and attendance",
    name: "Employee timecard",
    novaTimeName: "Employee Timecard",
    description: "A page for each employee with every punch, meal and time off line in the pay period, its pay code and hours, and lines to sign.",
    source: "ATTENDANCE_DETAIL",
    columns: ["date", "segmentType", "startTime", "endTime", "payCodeLabel", "reasonCode", "department", "regularMinutes", "overtimeMinutes", "paidMinutes"],
    groupBy: ["employeeName"],
    sortBy: BY_DAY,
    layout: { pageBreak: "employeeName", signature: { text: CERTIFY, employee: true, supervisor: true } },
    dates: "currentPayPeriod",
  },
  {
    id: "detail-signoff",
    folder: "Time and attendance",
    name: "Detail signoff report",
    novaTimeName: "Detail Signoff Report.TA",
    description: "The Detail report with a page for each department, its totals, and a line for the supervisor to sign it off.",
    source: "ATTENDANCE_DETAIL",
    columns: DETAIL_COLUMNS,
    groupBy: BY_SITE_AND_DEPARTMENT,
    sortBy: BY_NAME_THEN_DAY,
    layout: { pageBreak: "department", signature: { text: CERTIFY, employee: false, supervisor: true } },
    dates: "currentPayPeriod",
  },
  {
    id: "daily-hours",
    folder: "Time and attendance",
    name: "Daily hours report",
    novaTimeName: "Daily Hours Report",
    description: "One line for each employee and week, with the hours of each day of the week side by side, the week's total, and its regular and overtime hours.",
    source: "DAILY_HOURS",
    columns: ["employeeName", "employeeCode", "week", "totalMinutes", "regMinutes", "otMinutes", "dtMinutes"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    sortBy: BY_NAME_THEN_DAY,
    across: { field: "weekday", value: "totalMinutes" },
    dates: "currentPayPeriod",
  },
  {
    id: "timesheet-notes",
    folder: "Time and attendance",
    name: "Timesheet notes",
    novaTimeName: "Timesheet Notes",
    description: "Every note written on a timesheet in the pay period: the day, the note, who wrote it and when.",
    source: "TIMESHEET_NOTES",
    columns: ["employeeName", "employeeCode", "date", "note", "addedBy", "addedOn"],
    sortBy: BY_NAME_THEN_DAY,
    dates: "currentPayPeriod",
  },
  {
    id: "wage",
    folder: "Time and attendance",
    name: "Wage report",
    novaTimeName: "Wage Report",
    description: "Each line worked in the pay period with its pay code, pay rate, multiplier, paid hours and pay, by site and department.",
    source: "ATTENDANCE_DETAIL",
    columns: ["employeeCode", "employeeName", "date", "startTime", "endTime", "payCodeHours", "multiplier", "payRate", "paidMinutes", "payAmount"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    sortBy: BY_NAME_THEN_DAY,
    dates: "currentPayPeriod",
  },
  {
    id: "upload",
    folder: "Time and attendance",
    name: "Upload report",
    novaTimeName: "Upload Report",
    description: "The last pay period as a payroll file: one line per entry with the day, department, agency, pay code with its express and ADP codes, times, hours, rate and pay. Download it as CSV or Excel.",
    source: "ATTENDANCE_DETAIL",
    columns: [
      "date", "employeeCode", "employeeName", "department", "agency", "payCodeLabel", "expressCode", "adpCode", "startTime", "endTime",
      "regularMinutes", "overtimeMinutes", "doubletimeMinutes", "paidMinutes", "payRate", "payAmount",
    ],
    sortBy: BY_NAME_THEN_DAY,
    dates: "previousPayPeriod",
  },
  {
    id: "unclaimed-punches",
    folder: "Time and attendance",
    name: "Unclaimed punch report",
    novaTimeName: "Unclaimed Punch Report",
    description: "This month's scans of badges nobody in CloudTime has, by badge, with when and where each was read.",
    source: "SCANS_NOT_RECORDED",
    columns: ["date", "time", "site", "reader", "kind", "attempts"],
    filters: [{ field: "problem", operator: "eq", value: "Badge not found" }],
    groupBy: ["employeeCode"],
    dates: "currentMonth",
  },
  {
    id: "unsuccessful-punches",
    folder: "Time and attendance",
    name: "Unsuccessful punch report",
    novaTimeName: "Unsuccessful Punch Report",
    description: "Scans in the pay period that did not become a punch, and why: scanned again too soon, or turned away at the gate with no schedule.",
    source: "SCANS_NOT_RECORDED",
    columns: ["date", "time", "employeeName", "employeeCode", "problem", "reason", "site", "reader", "attempts"],
    filters: [{ field: "problem", operator: "in", value: ["Not recorded", "Turned away at the gate"] }],
    dates: "currentPayPeriod",
  },
  {
    id: "seven-day-review",
    folder: "Time and attendance",
    name: "7-day daily hours review",
    novaTimeName: "7-day Daily hours Review",
    description: "Each day an employee worked in the pay period, with that day's hours and the hours worked that day and the 6 before it, by employee.",
    source: "DAILY_HOURS",
    columns: ["date", "totalMinutes", "rolling7Minutes"],
    groupBy: ["site", "department", "employeeName"],
    sortBy: BY_DAY,
    dates: "currentPayPeriod",
  },
  {
    id: "rolling-seven-day",
    folder: "Time and attendance",
    name: "Rolling 7-day daily summary",
    novaTimeName: "Rolling 7-day Daily Summary",
    description: "The last 7 days for each employee: each day's hours and the hours worked over that day and the 6 before it. Filter by hours worked in 7 days to find long weeks.",
    source: "DAILY_HOURS",
    columns: ["date", "totalMinutes", "rolling7Minutes"],
    groupBy: ["site", "department", "employeeName"],
    sortBy: BY_DAY,
    dates: "last7Days",
  },
  {
    id: "ytd-averages",
    folder: "Time and attendance",
    name: "YTD averages report",
    novaTimeName: "YTD Averages Report",
    description: "Each employee's hours this week beside their hours this year, the weeks they worked, and their average a week and a day.",
    source: "HOURS_TO_DATE",
    columns: ["employeeName", "employeeCode", "regMinutes", "totalMinutes", "ytdMinutes", "weeksWorked", "weeklyAverageMinutes", "dailyAverageMinutes"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    dates: "currentWeek",
  },
  {
    id: "monthly-attendance-log",
    folder: "Time and attendance",
    name: "Monthly attendance log",
    novaTimeName: "Monthly Attendance Log",
    description: "Each employee's days in the pay period: worked, late, absent or off, scheduled start, clock times, minutes late, pay codes, reason codes and exceptions, with totals.",
    source: "DAILY_HOURS",
    columns: ["date", "dayType", "scheduledStart", "clockIn", "clockOut", "lateBy", "totalMinutes", "payCodes", "reasonCode", "exceptions"],
    groupBy: ["employeeName"],
    sortBy: BY_DAY,
    dates: "currentPayPeriod",
  },
  {
    id: "monthly-attendance-summary",
    folder: "Time and attendance",
    name: "Monthly attendance summary",
    novaTimeName: "Monthly Attendance Summary",
    description: "Each employee's month: days worked, days late, absences with and without a reason, and paid and unpaid time off, by department.",
    source: "ATTENDANCE_SUMMARY",
    columns: ["employeeName", "employeeCode", "month", "daysWorked", "lateDays", "absences", "excusedAbsences", "unexcusedAbsences", "timeOffMinutes", "unpaidMinutes"],
    groupBy: ["department"],
    dates: "currentMonth",
  },
  {
    id: "annual-attendance-log",
    folder: "Time and attendance",
    name: "Annual attendance log",
    novaTimeName: "Annual Attendance Log",
    description: "Each employee's late, absent and missed punch days with the reason code given, a page each to sign. Pick This year in Dates for the whole year.",
    source: "DAILY_HOURS",
    columns: ["date", "dayType", "reasonCode", "scheduledStart", "clockIn", "lateBy", "exceptions"],
    filters: [{ field: "dayType", operator: "in", value: ["Late", "Absent", "Missed punch"] }],
    groupBy: ["employeeName"],
    sortBy: BY_DAY,
    layout: { pageBreak: "employeeName", signature: { text: "", employee: true, supervisor: true } },
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
    columns: ["employeeName", "employeeCode", "payCategory", "payType", "flsaType", "hireDate", "status"],
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
    id: "employee-profile",
    folder: "Human resources",
    name: "Employee profile",
    novaTimeName: "Employee Profile",
    description: "A page for each current employee with their whole setup: site, department, agency, supervisor, pay rules, pay and dates.",
    source: "EMPLOYEES",
    columns: [
      "employeeName", "employeeCode", "status", "site", "department", "agency", "jobTitle", "supervisor", "role",
      "ruleSet", "shift", "holidayRule", "payCategory", "flsaType", "payType", "payRate", "markupPct", "chargeRate",
      "hireDate", "adjustedHireDate", "terminatedAt", "terminationReason", "timeZone", "email", "lastPunch",
    ],
    groupBy: ["employeeName"],
    layout: { pageBreak: "employeeName", cards: true },
    dates: "currentPayPeriod",
  },
  {
    id: "employee-activity",
    folder: "Human resources",
    name: "Employee activity report",
    novaTimeName: "Employee Activity Report",
    description: "Each employee's scheduled hours against the hours they worked in the pay period, with their time off, by site and department.",
    source: "SCHEDULED_HOURS",
    columns: ["employeeName", "employeeCode", "scheduledMinutes", "workedMinutes", "differenceMinutes", "timeOffMinutes", "lastPunch"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    dates: "currentPayPeriod",
  },
  {
    id: "attendance-review",
    folder: "Human resources",
    name: "Attendance review",
    novaTimeName: "Attendance Review",
    description: "Last month day by day for each employee: what each day was (worked, late, absent, off or holiday), the clock in, minutes late, pay codes and hours.",
    source: "DAILY_HOURS",
    columns: ["date", "dayType", "clockIn", "lateBy", "payCodes", "totalMinutes"],
    groupBy: ["employeeName"],
    sortBy: BY_DAY,
    dates: "previousMonth",
  },
  {
    id: "obbb-overtime",
    folder: "Human resources",
    name: "OBBB overtime pay summary",
    novaTimeName: "OBBB Overtime Pay Summary",
    description: "Each week an employee worked overtime this year, with the overtime hours, their pay rate and the OBBB amount: half the rate for each overtime hour.",
    source: "WEEKLY_OVERTIME",
    columns: ["employeeName", "employeeCode", "weekStart", "weekEnd", "otMinutes", "payRate", "obbbAmount"],
    groupBy: BY_SITE_AND_DEPARTMENT,
    dates: "currentYear",
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
    description: "Each current employee's time off earned, used and left this year, by type, by department.",
    source: "LEAVE_BALANCE",
    columns: ["employeeName", "employeeCode", "leaveType", "accrualYear", "earnedMinutes", "usedMinutes", "remainingMinutes"],
    filters: [{ field: "isActive", operator: "eq", value: "true" }],
    groupBy: ["department"],
    dates: "currentPayPeriod",
  },
  {
    id: "time-off-history",
    folder: "Accruals",
    name: "History report",
    novaTimeName: "History Report.ACC",
    description: "Every change to each employee's time off this year: earned, used, adjusted or carried over, with the balance after each, by employee.",
    source: "TIME_OFF_HISTORY",
    columns: ["leaveType", "postedOn", "entry", "earnedMinutes", "usedMinutes", "adjustedMinutes", "balanceAfterMinutes", "note"],
    groupBy: ["employeeName"],
    dates: "currentYear",
  },
  {
    id: "time-off-history-summary",
    folder: "Accruals",
    name: "History summary",
    novaTimeName: "History Summary.ACC",
    description: "For each employee and type of time off this year: the balance at the start, earned, used, adjusted and the balance now, by site.",
    source: "TIME_OFF_SUMMARY",
    columns: ["employeeName", "employeeCode", "leaveType", "startBalanceMinutes", "earnedMinutes", "usedMinutes", "adjustedMinutes", "endBalanceMinutes"],
    groupBy: ["site"],
    dates: "currentYear",
  },
  {
    id: "time-off-summary",
    folder: "Accruals",
    name: "Summary report",
    saveName: "Time off summary report",
    novaTimeName: "Summary Report.ACC",
    description: "Time off taken in the pay period by each employee and type, with what they have used this year and their balance, by department.",
    source: "TIME_OFF_SUMMARY",
    columns: ["employeeName", "employeeCode", "leaveType", "usedMinutes", "usedThisYearMinutes", "endBalanceMinutes"],
    groupBy: ["department"],
    dates: "currentPayPeriod",
  },
  {
    id: "accrued-vs-used",
    folder: "Accruals",
    name: "Annual accrued vs. used summary",
    novaTimeName: "Annual Accrued vs. Used Summary",
    description: "For each employee and type of time off this year: the balance at the start, earned and used each quarter, the totals, the balance now and a forecast for the year end at this year's pace.",
    source: "TIME_OFF_SUMMARY",
    columns: [
      "employeeName", "employeeCode", "leaveType", "startBalanceMinutes",
      "earnedQ1Minutes", "usedQ1Minutes", "earnedQ2Minutes", "usedQ2Minutes",
      "earnedQ3Minutes", "usedQ3Minutes", "earnedQ4Minutes", "usedQ4Minutes",
      "earnedThisYearMinutes", "usedThisYearMinutes", "endBalanceMinutes", "forecastMinutes",
    ],
    dates: "currentYear",
  },
  {
    id: "annual-requests",
    folder: "Accruals",
    name: "Annual time off request summary",
    novaTimeName: "Annual Time-Off Request Summary",
    description: "Time off requested this year (waiting, approved or taken) for each employee and type, one column for each month, with the year's total.",
    source: "LEAVE_SUMMARY",
    columns: ["employeeName", "employeeCode", "leaveType", "durationMinutes"],
    filters: [{ field: "status", operator: "in", value: ["PENDING", "PENDING_HR", "APPROVED", "POSTED"] }],
    across: { field: "month", value: "durationMinutes" },
    dates: "currentYear",
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
    id: "payroll-detail-signoff",
    folder: "Payroll",
    name: "Detail signoff report",
    saveName: "Payroll detail signoff report",
    novaTimeName: "Detail Signoff Report.PR",
    description: "The last pay period's Detail report, with a page for each department, its totals, and a line for the supervisor to sign it off.",
    source: "ATTENDANCE_DETAIL",
    columns: DETAIL_COLUMNS,
    groupBy: BY_SITE_AND_DEPARTMENT,
    sortBy: BY_NAME_THEN_DAY,
    layout: { pageBreak: "department", signature: { text: CERTIFY, employee: false, supervisor: true } },
    dates: "previousPayPeriod",
  },
  {
    id: "monthly-payroll",
    folder: "Payroll",
    name: "Monthly payroll report",
    novaTimeName: "Monthly Payroll Report.PR",
    description: "Last month's paid hours for each employee and pay code (overtime apart), one column for each day of the month, with totals.",
    source: "ATTENDANCE_DETAIL",
    columns: ["employeeName", "employeeCode", "payCodeHours", "paidMinutes"],
    groupBy: ["department"],
    sortBy: [{ field: "employeeName", direction: "asc" }],
    across: { field: "date", value: "paidMinutes" },
    dates: "previousMonth",
  },
  {
    id: "paycode-summary",
    folder: "Payroll",
    name: "Summary report by pay code",
    novaTimeName: "Summary Report By PayCode.PR",
    description: "The last pay period's paid hours for each employee, one column for each pay code with overtime apart, and totals by department.",
    source: "ATTENDANCE_DETAIL",
    columns: ["employeeName", "employeeCode", "paidMinutes", "regularMinutes", "overtimeMinutes", "doubletimeMinutes"],
    groupBy: ["department"],
    sortBy: [{ field: "employeeName", direction: "asc" }],
    across: { field: "payCodeHours", value: "paidMinutes" },
    dates: "previousPayPeriod",
  },
  {
    id: "payroll-exceptions",
    folder: "Payroll",
    name: "Exception report",
    saveName: "Payroll exception report",
    novaTimeName: "Exception Report.PR",
    description: "The last pay period's absences, missed punches and late or early days, by department, and whether each was fixed.",
    source: "EXCEPTION_REPORT",
    columns: EXCEPTION_COLUMNS,
    filters: [ATTENDANCE_EXCEPTIONS],
    groupBy: ["department"],
    dates: "previousPayPeriod",
  },
];

export function standardReport(id: string | null | undefined): StandardReport | undefined {
  return id ? STANDARD_REPORTS.find((r) => r.id === id) : undefined;
}
