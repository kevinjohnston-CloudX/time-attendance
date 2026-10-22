import type { ZodError } from "zod";

/**
 * A form check's failure in words that name the field.
 *
 * <p>A schema's own message ("Pick the columns for the new report type") is
 * kept. Zod's defaults reached people as they were: "Invalid input: expected
 * number, received NaN" for a pay rate typed as text, "Too small: expected
 * string to have >=1 characters" for an empty name. Those become "Pay rate
 * must be a number" and "Name is required".
 */

/** Field names whose words are not just the name split apart. */
const FIELD_LABEL: Record<string, string> = {
  wmsId: "Badge ID",
  employeeCode: "Badge ID",
  barcode: "Badge barcode",
  adpWorkerId: "ADP Worker ID",
  payRate: "Pay rate",
  rate1: "Pay rate",
  chargeRate: "Charge rate",
  markupPct: "Markup",
  siteId: "Site",
  siteIds: "Sites",
  departmentId: "Department",
  ruleSetId: "Rule set",
  shiftId: "Shift",
  leaveTypeId: "Leave type",
  payCodeId: "Pay code",
  reasonCodeId: "Reason",
  supervisorId: "Supervisor",
  customRoleId: "Role",
  employeeId: "Employee",
  targetEmployeeId: "Employee",
  timesheetId: "Timecard",
  payPeriodId: "Pay period",
  punchTime: "Time",
  durationMinutes: "Hours",
  hireDate: "Hire date",
  adjustedHireDate: "Adjusted hire date",
  terminatedAt: "Termination date",
  effectiveDate: "Effective date",
  startDate: "Start date",
  endDate: "End date",
  dateOfBirth: "Date of birth",
  email: "Email",
  workEmail: "Work email",
  name: "Name",
  note: "Note",
};

/** A field's words: its own label, or its name split at the capitals ("observedDate" → "Observed date"). */
export function fieldLabel(path: readonly PropertyKey[]): string | null {
  const key = [...path].reverse().find((p) => typeof p === "string") as string | undefined;
  if (!key) return null;
  if (FIELD_LABEL[key]) return FIELD_LABEL[key];
  const words = key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/** Zod's own wording starts like one of these; a schema's message does not. */
const DEFAULT = /^(Invalid input|Invalid option|Invalid string|Invalid type|Invalid date|Invalid enum|Invalid union|Invalid email|Too small|Too big|Required|Expected |Unrecognized key|String must|Number must|Array must)/;

type Issue = ZodError["issues"][number] & Record<string, unknown>;

export function zodMessage(err: ZodError): string {
  const issue = err.issues[0] as Issue | undefined;
  if (!issue) return "Some of the details are not valid. Check the form and try again.";
  if (!DEFAULT.test(issue.message)) return issue.message;

  const field = fieldLabel(issue.path) ?? "A value";
  const row = issue.path.find((p) => typeof p === "number");
  const where = typeof row === "number" && issue.path.length > 1 ? ` (row ${row + 1})` : "";
  const expected = String(issue.expected ?? "");
  // Zod leaves the rejected value off the issue unless asked, so a missing
  // one is read from its message ("expected string, received undefined").
  const missing = /received (undefined|null)\b/.test(issue.message) || issue.input === null || issue.input === "";

  switch (issue.code) {
    case "invalid_type": {
      if (missing) return `${field}${where} is required.`;
      if (expected === "number" || expected === "int" || expected === "bigint") return `${field}${where} must be a number.`;
      if (expected === "date") return `${field}${where} must be a date.`;
      if (expected === "boolean") return `${field}${where} must be yes or no.`;
      return `${field}${where} isn't valid.`;
    }
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") return min <= 1 ? `${field}${where} is required.` : `${field}${where} must be at least ${min} characters.`;
      if (issue.origin === "array" || issue.origin === "set") return min <= 1 ? `${field}${where}: pick at least one.` : `${field}${where}: pick at least ${min}.`;
      return issue.inclusive === false ? `${field}${where} must be more than ${min}.` : `${field}${where} must be at least ${min}.`;
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return `${field}${where} can be at most ${max} characters.`;
      if (issue.origin === "array" || issue.origin === "set") return `${field}${where} can have at most ${max}.`;
      return issue.inclusive === false ? `${field}${where} must be less than ${max}.` : `${field}${where} can be at most ${max}.`;
    }
    case "invalid_format":
      if (issue.format === "email") return `${field}${where} must be an email address.`;
      if (/date|time/i.test(String(issue.format ?? "")) || /date|time/i.test(field)) return `${field}${where} isn't a valid date.`;
      return `${field}${where} isn't in the right format.`;
    case "invalid_value": {
      const values = Array.isArray(issue.values) ? (issue.values as unknown[]).map(String) : [];
      return values.length && values.length <= 6 ? `${field}${where} must be one of: ${values.join(", ")}.` : `${field}${where} isn't one of the choices.`;
    }
    case "invalid_union":
      return `${field}${where} isn't valid.`;
    case "unrecognized_keys":
      return "Some of the details are not valid. Reload the page and try again.";
    default:
      return `${field}${where} isn't valid.`;
  }
}
