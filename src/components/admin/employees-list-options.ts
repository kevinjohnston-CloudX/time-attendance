/**
 * The Employees list's filter and sort choices. Their own module because both
 * sides use them: the list page and getEmployees read the query string, the
 * list draws the pills. Anything not listed here is ignored, so a hand edited
 * link cannot ask the database for a field it was never meant to sort on.
 */

/** Unset is current employees (active or on leave); "all" includes the inactive. */
export const STATUS_OPTIONS = [
  { id: "active", name: "Active" },
  { id: "leave", name: "On leave" },
  { id: "inactive", name: "Inactive" },
  { id: "all", name: "Everyone" },
] as const;

export const PAY_OPTIONS = [
  { id: "HOURLY", name: "Hourly" },
  { id: "SALARY", name: "Salary" },
] as const;

/** Records missing something they need: a badge to punch, a shift, a supervisor, a pay method. */
export const MISSING_OPTIONS = [
  { id: "badge", name: "Badge" },
  { id: "shift", name: "Shift" },
  { id: "supervisor", name: "Supervisor" },
  { id: "pay", name: "Pay method" },
] as const;

/** "" is the default: active people first, then by name. */
export const SORT_OPTIONS = [
  { id: "", name: "Active first" },
  { id: "name", name: "Name" },
  { id: "code", name: "Employee ID" },
  { id: "dept", name: "Department" },
  { id: "hired", name: "Newest hire" },
  { id: "added", name: "Recently added" },
] as const;

export type EmployeeStatus = (typeof STATUS_OPTIONS)[number]["id"];
export type EmployeePay = (typeof PAY_OPTIONS)[number]["id"];
export type EmployeeMissing = (typeof MISSING_OPTIONS)[number]["id"];
export type EmployeeSort = (typeof SORT_OPTIONS)[number]["id"];

/** A query string value if it is one of the choices, otherwise "". */
export function pick<T extends string>(options: readonly { id: T }[], value: string | undefined | null): T | "" {
  return options.some((o) => o.id === value) ? (value as T) : "";
}

/** Every query string key the list understands, for carrying a remembered list over. */
export const LIST_KEYS = ["q", "site", "dept", "role", "status", "shift", "pay", "missing", "sort", "page"] as const;
